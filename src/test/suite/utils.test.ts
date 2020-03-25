import { expect } from "chai";

import { Utils } from "../../Utils";

describe("Utils module", () => {
    describe("Path expansion", () => {
        it("Escapes special characters", () => {
            const path = "AFile%*#@.txt";
            expect(Utils.expansePath(path)).to.equal("AFile%25%2A%23%40.txt");
        });
        // TODO local dir settings (what is this for?)
    });
});
