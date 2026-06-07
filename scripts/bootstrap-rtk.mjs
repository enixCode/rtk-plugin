#!/usr/bin/env node
// SessionStart hook: ensure RTK binary is present in ${CLAUDE_PLUGIN_DATA}/rtk/.
// Downloads from github.com/rtk-ai/rtk/releases when local version differs.
// On any failure: log to stderr, exit 0. We never block a session.

import { mkdir, writeFile, readFile, rename, chmod, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, platform, arch, homedir } from "node:os";
import { join, basename } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const REQUIRED_RTK_VERSION = "v0.42.3";
const RTK_REPO = "rtk-ai/rtk";

class Logger {
  static info(msg) { process.stderr.write(`rtk-plugin: ${msg}\n`); }
  static bail(msg) { Logger.info(msg); process.exit(0); }
}

class Platform {
  static TARGETS = {
    "linux:x64":   "x86_64-unknown-linux-musl",
    "linux:arm64": "aarch64-unknown-linux-gnu",
    "darwin:x64":  "x86_64-apple-darwin",
    "darwin:arm64": "aarch64-apple-darwin",
    "win32:x64":   "x86_64-pc-windows-msvc",
  };
  static detect() {
    const key = `${platform()}:${arch()}`;
    const target = Platform.TARGETS[key];
    if (!target) return null;
    const isWindows = target.includes("windows");
    return {
      target,
      ext: isWindows ? "zip" : "tar.gz",
      binName: isWindows ? "rtk.exe" : "rtk",
      isWindows,
    };
  }
}

class ReleaseAsset {
  constructor(repo, version, plat) {
    this.url = `https://github.com/${repo}/releases/download/${version}/rtk-${plat.target}.${plat.ext}`;
    this.localName = `rtk.${plat.ext}`;
  }
  async download(destDir) {
    const dest = join(destDir, this.localName);
    const res = await fetch(this.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }
}

class Archive {
  constructor(path) { this.path = path; }
  extract(destDir) {
    // BSD tar on Windows reads "C:\..." as an SSH host AND can't read all zips,
    // so use PowerShell's Expand-Archive for .zip. For .tar.gz, run tar with
    // cwd=destDir + basename so the drive letter never reaches argv. Paths
    // injected into the PS command go via env vars to avoid quoting issues
    // with usernames like O'Brien.
    const isZip = this.path.toLowerCase().endsWith(".zip");
    if (isZip) {
      const env = { ...process.env, RTK_ARCHIVE: this.path, RTK_DEST: destDir };
      const args = ["-NoProfile", "-Command", "Expand-Archive -LiteralPath $env:RTK_ARCHIVE -DestinationPath $env:RTK_DEST -Force"];
      return Archive.run("powershell", args, { stdio: "inherit", env });
    }
    return Archive.run("tar", ["-xf", basename(this.path)], { stdio: "inherit", cwd: destDir });
  }
  static run(cmd, args, opts) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, opts);
      p.on("error", reject);
      p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    });
  }
  static async findBinary(dir, name) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name === name) return full;
      if (entry.isDirectory()) {
        const nested = await Archive.findBinary(full, name);
        if (nested) return nested;
      }
    }
    return null;
  }
}

class RtkInstall {
  constructor(dataDir) {
    this.rtkDir = join(dataDir, "rtk");
    this.versionFile = join(this.rtkDir, ".version");
  }
  async isCurrent(version) {
    if (!existsSync(this.versionFile)) return false;
    return (await readFile(this.versionFile, "utf8")).trim() === version;
  }
  currentBinary() {
    for (const name of ["rtk.exe", "rtk"]) {
      const p = join(this.rtkDir, name);
      if (existsSync(p)) return p;
    }
    return null;
  }
  async commit(binarySrc, binName, version, isWindows) {
    const dest = join(this.rtkDir, binName);
    // Atomic-replace the binary too: a partially written rtk.exe would make
    // existsSync() lie to the dispatcher, which would then spawn a broken
    // binary. Write into <dest>.new on the destination FS first so the final
    // rename is always same-FS (and therefore atomic).
    const destTmp = `${dest}.new`;
    try { await rename(binarySrc, destTmp); }
    catch { await writeFile(destTmp, await readFile(binarySrc)); }
    if (!isWindows) await chmod(destTmp, 0o755).catch(() => {});
    await rename(destTmp, dest);
    // Write .version atomically too: a partially written file would make
    // isCurrent() misreport on the next session start.
    const versionTmp = `${this.versionFile}.new`;
    await writeFile(versionTmp, version);
    await rename(versionTmp, this.versionFile);
    return dest;
  }
}

class Bootstrap {
  constructor() {
    const data = process.env.CLAUDE_PLUGIN_DATA
      ?? join(homedir(), ".claude", "plugins", "data", "rtk-plugin");
    this.install = new RtkInstall(data);
    this.tmp = join(tmpdir(), `rtk-${randomBytes(6).toString("hex")}`);
  }
  async run() {
    await mkdir(this.install.rtkDir, { recursive: true });
    if (await this.install.isCurrent(REQUIRED_RTK_VERSION)) {
      await Bootstrap.initRtk(this.install.currentBinary());
      process.exit(0);
    }

    const plat = Platform.detect();
    if (!plat) Logger.bail(`unsupported platform ${platform()} ${arch()}`);

    await mkdir(this.tmp, { recursive: true });
    Logger.info(`downloading RTK ${REQUIRED_RTK_VERSION} for ${plat.target}...`);

    const asset = new ReleaseAsset(RTK_REPO, REQUIRED_RTK_VERSION, plat);
    let archivePath;
    try { archivePath = await asset.download(this.tmp); }
    catch (e) { Logger.bail(`download failed: ${e.message}`); }

    try { await new Archive(archivePath).extract(this.tmp); }
    catch (e) { Logger.bail(`extract failed: ${e.message}`); }

    const found = await Archive.findBinary(this.tmp, plat.binName);
    if (!found) Logger.bail(`${plat.binName} not found in archive`);

    const dest = await this.install.commit(found, plat.binName, REQUIRED_RTK_VERSION, plat.isWindows);
    Logger.info(`RTK ${REQUIRED_RTK_VERSION} ready at ${dest}`);
    await Bootstrap.initRtk(dest);
  }

  static async initRtk(binary) {
    try {
      await Archive.run(binary, ["init", "-g"], { stdio: "ignore" });
    } catch {}
  }
}

await new Bootstrap().run();
