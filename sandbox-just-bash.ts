import { Sandbox as JustBashSandbox } from "just-bash";
import type { Sandbox } from "./sandbox.js";

const MOUNT = "/home/user/project";

export async function createJustBashSandbox(dir: string): Promise<Sandbox> {
  const jb = await JustBashSandbox.create({
    overlayRoot: dir,
    defenseInDepth: false,
  });

  return {
    type: "just-bash",
    workingDirectory: MOUNT,
    readFile: async (p) => {
      const virtualPath = `${MOUNT}/${p}`;
      return jb.readFile(virtualPath);
    },
    exec: async (command) => {
      console.error(command);
      const cmd = await jb.runCommand(command, { cwd: MOUNT });
      const finished = await cmd.wait();
      return {
        stdout: await cmd.output(),
        exitCode: finished.exitCode,
      };
    },
    stop: async () => {},
  };
}
