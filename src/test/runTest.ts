import * as path from "path";

import { runTests } from "vscode-test";

type Env = { [key: string]: string };
type Params = { [key: string]: string | boolean };

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        const testWorkspace = path.resolve(__dirname, "../../test-fixtures/core/");

        const params: Params = process.argv.slice(2).reduce((all, cur) => {
            const [name, val] = cur.split("=");
            const finalVal = val ? val : true;
            all[name] = finalVal;
            return all;
        }, {} as Params);

        const env: Env = {};
        if (params["--display"]) {
            env["DISPLAY"] = params["--display"] as string;
            console.log(
                "\nRUNNING WITH DISPLAY: " +
                    params["--display"] +
                    "\n\tNb: Before running with this mode, you should have run Xvfb, e.g.\n" +
                    "\tXvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &\n\n"
            );
        }

        // Download VS Code, unzip it and run the integration test
        await runTests({
            version: "insiders",
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [testWorkspace],
            extensionTestsEnv: env
        });
    } catch (err) {
        console.error("Failed to run tests: " + err);
        process.exit(1);
    }
}

main();
