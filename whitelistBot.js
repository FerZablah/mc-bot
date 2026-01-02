// whitelistBot.js
import SftpClient from "ssh2-sftp-client";
import fs from "node:fs";
import crypto from "node:crypto";
import { Rcon } from "rcon-client";

export function offlineModeUuid(username) {
  const md5 = crypto.createHash("md5")
    .update(`OfflinePlayer:${username}`, "utf8")
    .digest();

  // RFC 4122 v3 + variant bits (matches Java UUID.nameUUIDFromBytes)
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;

  const hex = md5.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function upsertWhitelist(arr, name, uuid) {
  const lowerUuid = uuid.toLowerCase();

  const idxByName = arr.findIndex(e => e?.name === name);
  if (idxByName >= 0) {
    const old = String(arr[idxByName]?.uuid || "").toLowerCase();
    if (old !== lowerUuid) {
      arr[idxByName].uuid = uuid;
      return true;
    }
    return false;
  }

  const existsUuid = arr.some(e => String(e?.uuid || "").toLowerCase() === lowerUuid);
  if (!existsUuid) {
    arr.push({ uuid, name });
    return true;
  }
  return false;
}

export async function ensureBotWhitelisted(botName, opts) {
  const {
    winHost,
    winUser,
    winPrivateKeyPath,
    whitelistPath,

    rconHost,
    rconPort,
    rconPassword,

    reloadAlways = true, // you said you want reload executed by the script
  } = opts;

  if (!botName) throw new Error("botName is required");
  if (!winHost || !winUser || !winPrivateKeyPath || !whitelistPath) {
    throw new Error("Missing SFTP options: winHost, winUser, winPrivateKeyPath, whitelistPath");
  }

  const uuid = offlineModeUuid(botName);

  // 1) Update whitelist.json over SFTP
  const sftp = new SftpClient();
  await sftp.connect({
    host: winHost,
    username: winUser,
    privateKey: fs.readFileSync(winPrivateKeyPath),
  });

  let changed = false;

  try {
    const buf = await sftp.get(whitelistPath);
    const arr = JSON.parse(buf.toString("utf8"));
    if (!Array.isArray(arr)) throw new Error("whitelist.json is not an array");

    changed = upsertWhitelist(arr, botName, uuid);

    if (changed) {
      const tmp = `${whitelistPath}.tmp`;
      await sftp.put(Buffer.from(JSON.stringify(arr, null, 2) + "\n", "utf8"), tmp);
      await sftp.rename(tmp, whitelistPath);
    }
  } finally {
    await sftp.end().catch(() => {});
  }

  // 2) Reload whitelist over RCON
  let reloaded = false;
  if (rconHost && rconPort && rconPassword && (reloadAlways || changed)) {
    const rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPassword });
    try {
      await rcon.send("whitelist reload");
      reloaded = true;
    } finally {
      rcon.end();
    }
  } else {
    // If you don't configure RCON, the file will update but Paper won't reload automatically
    // until restart / manual reload.
  }

  return { botName, uuid, changed, reloaded };
}
