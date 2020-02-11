import { expect } from "chai";

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as sinonChai from "sinon-chai";

import * as sinon from "sinon";
import { debounce, DebouncedFunction } from "../../../Debounce";

chai.use(sinonChai);
chai.use(chaiAsPromised);

function timeout(ms: number) {
    return new Promise(res => {
        setTimeout(() => {
            res();
        }, ms);
    });
}

describe("Debounce", () => {
    let callee: sinon.SinonSpy;
    let debounced: DebouncedFunction<any[], any>;

    beforeEach(() => {
        callee = sinon.stub().returnsArg(0);
        debounced = debounce(callee, 10);
    });
    afterEach(() => {
        if (debounced) {
            debounced.dispose();
        }
        sinon.restore();
    });
    it("Calls the function on the leading edge with supplied params", async () => {
        debounced("param");
        await timeout(0);
        expect(callee).to.have.been.calledOnce;
        expect(callee).to.have.returned("param");
    });
    it("Calls the function on the trailing edge if called again within `time` ms", async () => {
        const p1 = debounced("1");
        const p2 = debounced("2");

        expect(await p1).to.equal("1");
        expect(callee).to.have.been.calledOnce;

        expect(await p2).to.equal("2");
        expect(callee).to.have.been.calledTwice;
    });
    it("Uses the last call's args when multiple calls are delayed", async () => {
        const p1 = debounced("1");
        const p2 = debounced("2");
        expect(debounced("3")).to.equal(p2);
        expect(debounced("4")).to.equal(p2);

        expect(await p1).to.equal("1");
        expect(await p2).to.equals("4");
        expect(callee).to.not.have.been.calledWith("2");
        expect(callee).to.not.have.been.calledWith("3");
        expect(callee).to.have.been.calledTwice;
    });
    it("Resets behaviour when time ms has elapsed, after first call with no delayed calls", async () => {
        debounced("1");
        await timeout(20);

        expect(callee).to.have.returned("1");

        const p2 = debounced("2");
        const p3 = debounced("3");

        expect(debounced("4")).to.equal(p3);
        expect(await p2).to.equal("2");
        expect(await p3).to.equal("4");
    });
    it("Resets behaviour when time ms has elapsed, after the last delayed call", async () => {
        debounced("1");
        expect(await debounced("2")).to.equal("2");

        const p3 = debounced("3");
        const p4 = debounced("4");

        expect(debounced("5")).to.equal(p4);
        expect(await p3).to.equal("3");
        expect(await p4).to.equal("5");
    });
    it("Can omit the leading call", async () => {
        debounced.withoutLeadingCall("nolead");
        await timeout(0);
        expect(callee).not.to.have.been.called;
        await timeout(10);
        expect(callee).to.have.been.called;
        expect(callee).to.have.returned("nolead");
    });
    it("Can't omit a leading call that has already been made, but continues as normal", async () => {
        const p1 = debounced("withlead");
        debounced.withoutLeadingCall("nolead");
        debounced.withoutLeadingCall("nolead-2");
        expect(callee).to.have.been.calledOnce;
        expect(await p1).to.equal("withlead");
        await timeout(10);
        expect(callee).to.have.been.calledTwice;
        expect(callee).to.have.returned("nolead-2");
    });
    it("Resolves initial function when disposed in the same frame", async () => {
        const p1 = debounced("1");
        debounced.dispose();
        expect(await p1).to.equal("1");
    });
    it("Rejects outstanding promises when disposed in the same frame", async () => {
        const p1 = debounced("1");
        const p2 = debounced("2");
        debounced.dispose();
        expect(await p1).to.equal("1");
        await expect(p2).to.eventually.be.rejectedWith("Debounced function cancelled");
    });
    it("Rejects outstanding promises when disposed during wait", async () => {
        const p1 = debounced("1");
        const p2 = debounced("2");
        expect(await p1).to.equal("1");
        debounced.dispose();
        await expect(p2).to.eventually.be.rejectedWith("Debounced function cancelled");
    });
    it("Can be disposed multiple times without error", async () => {
        const p1 = debounced("1");
        const p2 = debounced("2");
        debounced.dispose();
        debounced.dispose();
        expect(await p1).to.equal("1");
        debounced.dispose();
        debounced.dispose();
        await expect(p2).to.eventually.be.rejectedWith("Debounced function cancelled");
    });
    it("Calls the onCall event immediately for every normal call", async () => {
        const spy = sinon.spy();
        const db2 = debounce(callee, 10, spy);

        db2("1");
        db2("2");
        const prom = db2("3");

        expect(spy).to.have.been.calledWith("1");
        expect(spy).to.have.been.calledWith("2");
        expect(spy).to.have.been.calledWith("3");
        await prom;
        expect(callee).to.have.been.calledWith("1");
        expect(callee).not.to.have.been.calledWith("2");
        expect(callee).to.have.been.calledWith("3");
    });
    it("Calls the onCall event immediately for without-leading call", async () => {
        const spy = sinon.spy();
        const db2 = debounce(callee, 10, spy);

        db2.withoutLeadingCall("1");
        db2.withoutLeadingCall("2");
        const prom = db2.withoutLeadingCall("3");

        expect(spy).to.have.been.calledWith("1");
        expect(spy).to.have.been.calledWith("2");
        expect(spy).to.have.been.calledWith("3");
        await prom;
        expect(callee).not.to.have.been.calledWith("1");
        expect(callee).not.to.have.been.calledWith("2");
        expect(callee).to.have.been.calledWith("3");
    });
});
