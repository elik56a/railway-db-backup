// index.ts
import { drive } from "@googleapis/drive";
import { exec, execSync } from "child_process";
import "dotenv/config";
import { filesize } from "filesize";
import { createReadStream, statSync } from "fs";
import { unlink } from "fs/promises";
import { JWT } from "google-auth-library";
import * as os from "os";
import * as path from "path";

const env = {
  DATABASE_URL: process.env.DATABASE_URL || "",
  SERVICE_ACCOUNT: JSON.parse(process.env.SERVICE_ACCOUNT || "{}"),
  FOLDER_ID: process.env.FOLDER_ID || "",
  FILE_PREFIX: process.env.FILE_PREFIX || "db-backup-",
};

if (process.env.RUN_BACKUP_CRON !== "true") {
  console.log("⏭ Skipped: Not triggered by cron (RUN_BACKUP_CRON != true)");
  process.exit(0);
}

const auth = new JWT({
  email: env.SERVICE_ACCOUNT.client_email,
  key: env.SERVICE_ACCOUNT.private_key,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const gdrive = drive({ version: "v3", auth });

const dumpToFile = async (filepath: string) => {
  return new Promise((resolve, reject) => {
    exec(
      `pg_dump --dbname=${env.DATABASE_URL} --format=tar | gzip > ${filepath}`,
      (err, stdout, stderr) => {
        if (err) {
          reject(err.message);
          return;        }

        const isFileValid = execSync(`gzip -cd ${filepath} | head -c1`).length > 0;
        if (!isFileValid) return reject("Backup file is empty");

        console.log(`✅ Dumped: ${filesize(statSync(filepath).size)} at ${filepath}`);
        resolve(stdout);
      }
    );
  });
};

const pushToDrive = async (filename: string, filepath: string) => {
  await gdrive.files.create({
    requestBody: {
      name: filename,
      parents: [env.FOLDER_ID],
    },
    media: {
      mimeType: "application/gzip",
      body: createReadStream(filepath),
    },
  });
};

(async () => {
  try {
    const now = new Date();
const timestamp = now
  .toISOString()
  .replace(/\..+/, "")       // remove milliseconds and Z
  .replace(/:/g, "-");       // replace colons with dashes

const filename = `${env.FILE_PREFIX}${timestamp}.tar.gz`;
    const filepath = path.join(os.tmpdir(), filename);

    console.log(`🚀 Starting DB backup: ${filename}`);
    await dumpToFile(filepath);

    console.log("📤 Uploading to Google Drive...");
    await pushToDrive(filename, filepath);

    await unlink(filepath);
    console.log("✅ Done!");
  } catch (err) {
    console.error("❌ Backup failed:", err);
  }
})();
