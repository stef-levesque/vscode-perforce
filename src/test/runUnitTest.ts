import { run } from "./suite/unit/index";

async function main() {
    try {
        await run();
    } catch (err) {
        console.error("Failed to run tests " + err);
        process.exit(1);
    }
}

main();
