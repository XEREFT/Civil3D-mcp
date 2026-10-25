// writeFileSync that also works on a Hidden file (Windows refuses to truncate a file with the Hidden attribute: EPERM). The BASE folders keep project.json hidden.
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
export function writeText(path, text) {
  try { writeFileSync(path, text); }
  catch (e) {
    if (!/EPERM|EACCES/.test(String(e?.code))) throw e;
    spawnSync("attrib", ["-h", path]);
    writeFileSync(path, text);
    spawnSync("attrib", ["+h", path]);
  }
}
