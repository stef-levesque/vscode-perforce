import * as path from "path";
import Mocha from "mocha";
import glob from "glob";

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "bdd"
    });
    mocha.reporter("cypress-multi-reporters", {
        reporterEnabled: "mocha-junit-reporter, spec",
        mochaJunitReporterReporterOptions: {
            mochaFile: "./reports/junit-unit.xml"
        }
    });
    mocha.useColors(true);

    const testsRoot = __dirname;

    return new Promise((c, e) => {
        glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
            if (err) {
                return e(err);
            }

            // Add files to the test suite
            files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // Run the mocha test
                mocha.run(failures => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                e(err);
            }
        });
    });
}
