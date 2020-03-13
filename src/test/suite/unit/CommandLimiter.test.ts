import { expect } from "chai";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

import * as sinon from "sinon";
import { Queue, CommandLimiter } from "../../../CommandLimiter";

chai.use(sinonChai);
chai.use(chaiAsPromised);

type Hello = { hello: string };

describe("Command Limiter (unit)", () => {
    describe("Queue", () => {
        const obj1 = { hello: "world" };
        const obj2 = { hello: "this" };
        const obj3 = { hello: "is a test" };
        it("Returns undefined when dequeuing from an empty queue", () => {
            const queue = new Queue<number>();
            expect(queue).to.have.lengthOf(0);
            expect(queue.dequeue()).to.be.undefined;
        });
        it("Returns the same object that was queued", () => {
            const queue = new Queue<Hello>();
            queue.enqueue(obj1);
            expect(queue).to.have.lengthOf(1);
            expect(queue.dequeue()).to.equal(obj1);
            expect(queue).to.have.lengthOf(0);
        });
        it("Dequeues objects in the order they were entered", () => {
            const queue = new Queue<Hello>();
            expect(queue).to.have.lengthOf(0);
            queue.enqueue(obj1);
            expect(queue).to.have.lengthOf(1);
            queue.enqueue(obj2);
            expect(queue).to.have.lengthOf(2);
            queue.enqueue(obj3);
            expect(queue).to.have.lengthOf(3);

            expect(queue.dequeue()).to.equal(obj1);
            expect(queue).to.have.lengthOf(2);
            expect(queue.dequeue()).to.equal(obj2);
            expect(queue).to.have.lengthOf(1);
            expect(queue.dequeue()).to.equal(obj3);
            expect(queue).to.have.lengthOf(0);
            expect(queue.dequeue()).to.be.undefined;
        });
        it("Can enqueue after emptying", () => {
            const queue = new Queue<Hello>();

            queue.enqueue(obj2);
            queue.enqueue(obj1);
            expect(queue.dequeue()).to.equal(obj2);
            expect(queue.dequeue()).to.equal(obj1);
            expect(queue.dequeue()).to.be.undefined;

            queue.enqueue(obj3);
            queue.enqueue(obj1);
            expect(queue.dequeue()).to.equal(obj3);
            expect(queue.dequeue()).to.equal(obj1);
        });
        it("Can enqueue after partial emptying", () => {
            const queue = new Queue<Hello>();

            queue.enqueue(obj1);
            queue.enqueue(obj2);
            queue.enqueue(obj3);
            expect(queue.dequeue()).to.equal(obj1);
            expect(queue.dequeue()).to.equal(obj2);
            expect(queue).to.have.lengthOf(1);
            queue.enqueue(obj1);
            expect(queue).to.have.lengthOf(2);
            expect(queue.dequeue()).to.equal(obj3);
            expect(queue.dequeue()).to.equal(obj1);
            expect(queue).to.have.lengthOf(0);
        });
        it("Can enqueue the same object n times in a row", () => {
            const queue = new Queue<Hello>();

            queue.enqueue(obj1);
            queue.enqueue(obj1);
            queue.enqueue(obj1);
            expect(queue.dequeue()).to.equal(obj1);
            expect(queue.dequeue()).to.equal(obj1);
            expect(queue.dequeue()).to.equal(obj1);
            expect(queue.dequeue()).to.be.undefined;
        });
        it("Can enqueue / dequeue a large number of objects", () => {
            const queue = new Queue<Hello>();

            const items: Hello[] = [];
            for (let i = 0; i < 50000; ++i) {
                const item = { hello: "number " + i };
                items.push(item);
                queue.enqueue(item);
            }

            expect(queue).to.have.lengthOf(50000);
            items.forEach(item => expect(queue.dequeue()).to.equal(item));
            expect(queue).to.have.lengthOf(0);
        });
    });

    describe("Limiter", () => {
        let cbs: sinon.SinonStub[];
        beforeEach(() => {
            cbs = [
                sinon.stub().callsArg(0),
                sinon.stub().callsFake(c =>
                    setTimeout(() => {
                        c();
                    }, 2)
                ),
                sinon.stub().callsFake(c =>
                    setTimeout(() => {
                        c();
                    }, 4)
                )
            ];
        });
        it("Starts with empty queue and running count", () => {
            const cl = new CommandLimiter(1);
            expect(cl.queueLength).to.equal(0);
            expect(cl.runningCount).to.equal(0);
        });
        it("Runs the command as a callback", async () => {
            const cl = new CommandLimiter(1);
            const promise = cl.submit(cbs[0], "1");
            expect(cl).to.include({ queueLength: 0, runningCount: 1 });
            expect(cbs[0]).not.to.have.been.called;
            await promise;
            expect(cl).to.include({ queueLength: 0, runningCount: 0 });
            expect(cbs[0]).to.have.been.calledOnce;
        });
        it("Queues while maxConcurrent commands are running (1)", async () => {
            const cl = new CommandLimiter(1);

            const p1 = cl.submit(cbs[0], "1");
            expect(cl).to.include({ queueLength: 0, runningCount: 1 });
            const p2 = cl.submit(cbs[1], "2");
            expect(cl).to.include({ queueLength: 1, runningCount: 1 });
            const p3 = cl.submit(cbs[2], "3");
            expect(cl).to.include({ queueLength: 2, runningCount: 1 });

            expect(cbs[0]).not.to.have.been.called;
            await p1;
            expect(cl).to.include({ queueLength: 1, runningCount: 1 });
            expect(cbs[0]).to.have.been.calledOnce;

            expect(cbs[1]).not.to.have.been.called;
            await p2;
            expect(cl).to.include({ queueLength: 0, runningCount: 1 });
            expect(cbs[1]).to.have.been.calledOnce;

            expect(cbs[2]).not.to.have.been.called;
            await p3;
            expect(cl).to.include({ queueLength: 0, runningCount: 0 });
            expect(cbs[2]).to.have.been.calledOnce;
        });
        it("Queues while maxConcurrent commands are running (2)", async () => {
            const cl = new CommandLimiter(2);

            const p1 = cl.submit(cbs[0], "1");
            expect(cl).to.include({ queueLength: 0, runningCount: 1 });
            const p2 = cl.submit(cbs[1], "2");
            expect(cl).to.include({ queueLength: 0, runningCount: 2 });
            const p3 = cl.submit(cbs[2], "3");
            expect(cl).to.include({ queueLength: 1, runningCount: 2 });

            expect(cbs[0]).not.to.have.been.called;
            expect(cbs[1]).not.to.have.been.called;
            expect(cbs[2]).not.to.have.been.called;

            await p1;
            expect(cl).to.include({ queueLength: 0, runningCount: 2 });
            expect(cbs[0]).to.have.been.calledOnce;

            await p2;
            expect(cl).to.include({ queueLength: 0, runningCount: 1 });
            expect(cbs[1]).to.have.been.calledOnce;

            await p3;
            expect(cl).to.include({ queueLength: 0, runningCount: 0 });
            expect(cbs[2]).to.have.been.calledOnce;
        });
        it("Runs jobs asynchronously", async () => {
            const cl = new CommandLimiter(2);

            const c1 = sinon.stub().callsFake(c => c());
            const c2 = sinon.stub().callsFake(c => c());

            const p1 = cl.submit(
                c =>
                    setTimeout(() => {
                        c1(c);
                    }, 40),
                "1"
            );

            expect(cl).to.include({ queueLength: 0, runningCount: 1 });

            const p2 = cl.submit(
                c =>
                    setTimeout(() => {
                        c2(c);
                    }, 5),
                "2"
            );

            expect(cl).to.include({ queueLength: 0, runningCount: 2 });

            expect(c1).not.to.have.been.called;
            expect(c2).not.to.have.been.called;

            await p2;
            expect(c1).not.to.have.been.called;
            expect(c2).to.have.been.calledOnce;

            expect(cl).to.include({ queueLength: 0, runningCount: 1 });

            await p1;
            expect(c1).to.have.been.calledOnce;

            expect(cl).to.include({ queueLength: 0, runningCount: 0 });
        });
        it("Does not queue when maxConcurrent is 0", async () => {
            const cl = new CommandLimiter(0);

            cl.submit(cbs[0], "1");
            cl.submit(cbs[1], "2");
            const p3 = cl.submit(cbs[2], "3");
            expect(cl).to.include({ queueLength: 0, runningCount: 3 });

            expect(cbs[0]).not.to.have.been.called;
            expect(cbs[1]).not.to.have.been.called;
            expect(cbs[2]).not.to.have.been.called;

            await p3;

            expect(cbs[0]).to.have.been.calledOnce;
            expect(cbs[1]).to.have.been.calledOnce;
            expect(cbs[2]).to.have.been.calledOnce;
        });
        it("Immediately completes jobs that throw an error", async () => {
            const cl = new CommandLimiter(1);
            const thrower = sinon.fake.throws(new Error("an error"));
            const p1 = cl.submit(thrower, "1");
            const p2 = cl.submit(cbs[0], "2");
            expect(cl).to.include({ queueLength: 1, runningCount: 1 });
            expect(thrower).not.to.have.been.called;

            await expect(p1).to.eventually.be.rejectedWith("an error");

            expect(cl).to.include({ queueLength: 0, runningCount: 1 });

            await p2;
            expect(cbs[0]).to.have.been.calledOnce;
        });
    });
});
