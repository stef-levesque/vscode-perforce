import * as p4 from "../../api/PerforceApi";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { PerforceService } from "../../PerforceService";
import { getWorkspaceUri } from "../helpers/testUtils";

import { expect } from "chai";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as sinonChai from "sinon-chai";
import { ChangeSpec, ChangeInfo, FixedJob } from "../../api/CommonTypes";

chai.use(sinonChai);
chai.use(chaiAsPromised);

function basicExecuteStub(
    _resource: vscode.Uri,
    command: string,
    responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
    args?: string[],
    _directoryOverride?: string | null,
    _input?: string
) {
    let out = command;
    if (args && args.length > 0) {
        out += " " + args.join(" ");
    }
    setImmediate(() => responseCallback(null, out, ""));
}

function execWithResult(err: Error | null, stdout: string, stderr: string) {
    return (
        _resource: any,
        _command: string,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
        setImmediate(() => responseCallback(err, stdout, stderr));
    };
}

function execWithStdOut(stdout: string) {
    return execWithResult(null, stdout, "");
}

function execWithStdErr(stderr: string) {
    return execWithResult(null, "", stderr);
}

function execWithErr(err: Error) {
    return execWithResult(err, "", "");
}

describe("Perforce API", () => {
    let execute: sinon.SinonStub<Parameters<typeof basicExecuteStub>, void>;
    const ws = getWorkspaceUri();

    beforeEach(() => {
        execute = sinon.stub(PerforceService, "execute").callsFake(basicExecuteStub);
    });
    afterEach(() => {
        expect(execute).to.always.have.been.calledWith(ws);
        sinon.restore();
    });
    describe("Flag mapper", () => {
        it("maps flags");
    });
    describe("Simple commands", () => {
        it("makes a simple command");
    });
    describe("Get change Spec", () => {
        it("Outputs a change spec", async () => {
            execute.callsFake(
                execWithStdOut(
                    "# A Perforce Change Specification.\n" +
                        "#\n" +
                        "#  Change:      The change number. 'new' on a new changelist.\n" +
                        "#  Date:        The date this specification was last modified.\n" +
                        "#  etc\n" +
                        "\n" +
                        "Change:\tnew\n" +
                        "\n" +
                        "Client:\tcli\n" +
                        "\n" +
                        "User:\tuser\n" +
                        "\n" +
                        "Status:\tnew\n" +
                        "\n" +
                        "Description:\n" +
                        "\t<enter description here>\n" +
                        "\n" +
                        "Files:\n" +
                        "//depot/testArea/testFile\t# edit"
                )
            );
            await expect(p4.getChangeSpec(ws, {})).to.eventually.deep.equal({
                description: "<enter description here>",
                files: [{ depotPath: "//depot/testArea/testFile", action: "edit" }],
                change: "new",
                rawFields: [
                    { name: "Change", value: ["new"] },
                    { name: "Client", value: ["cli"] },
                    { name: "User", value: ["user"] },
                    { name: "Status", value: ["new"] },
                    { name: "Description", value: ["<enter description here>"] },
                    { name: "Files", value: ["//depot/testArea/testFile\t# edit"] }
                ]
            });
        });
        it("Outputs a change spec for an existing changelist", async () => {
            execute.callsFake(
                execWithStdOut(
                    "# A Perforce Change Specification.\n" +
                        "#\n" +
                        "#  Change:      The change number. 'new' on a new changelist.\n" +
                        "#  Date:        The date this specification was last modified.\n" +
                        "#  etc\n" +
                        "\n" +
                        "Change:\t123\n" +
                        "\n" +
                        "Client:\tcli\n" +
                        "\n" +
                        "User:\tuser\n" +
                        "\n" +
                        "Status:\tpending\n" +
                        "\n" +
                        "Description:\n" +
                        "\tchangelist line 1\n\tchangelist line 2"
                )
            );
            await expect(
                p4.getChangeSpec(ws, { existingChangelist: "123" })
            ).to.eventually.deep.equal({
                description: "changelist line 1\nchangelist line 2",
                change: "123",
                files: undefined,
                rawFields: [
                    { name: "Change", value: ["123"] },
                    { name: "Client", value: ["cli"] },
                    { name: "User", value: ["user"] },
                    { name: "Status", value: ["pending"] },
                    {
                        name: "Description",
                        value: ["changelist line 1", "changelist line 2"]
                    }
                ]
            });
        });
    });
    describe("Input change spec", () => {
        it("Inputs a change spec and returns the change number", async () => {
            execute.callsFake(execWithStdOut("Change 99 created."));
            const changeSpec: ChangeSpec = {
                description: "my change spec\nhere it is",
                change: "new",
                files: [{ depotPath: "//depot/testArea/myFile.txt", action: "add" }],
                rawFields: []
            };
            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.deep.equal({ rawOutput: "Change 99 created.", chnum: "99" });

            expect(execute).to.have.been.calledWithMatch(
                ws,
                "change",
                sinon.match.any,
                ["-i"],
                null,
                "Change:\tnew\n\n" +
                    "Description:\tmy change spec\n\there it is\n\n" +
                    "Files:\t//depot/testArea/myFile.txt\t# add"
            );
        });
        it("Updates an existing change spec and returns the change number", async () => {
            execute.callsFake(execWithStdOut("Change 1234 updated."));
            const changeSpec: ChangeSpec = {
                description: "a spec",
                change: "1234",
                files: [{ depotPath: "//depot/testArea/myEdit.txt", action: "edit" }],
                rawFields: [
                    { name: "Description", value: ["no-override"] },
                    { name: "Raw", value: ["value"] }
                ]
            };
            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.deep.equal({
                rawOutput: "Change 1234 updated.",
                chnum: "1234"
            });

            expect(execute).to.have.been.calledWithMatch(
                ws,
                "change",
                sinon.match.any,
                ["-i"],
                null,
                "Change:\t1234\n\n" +
                    "Description:\ta spec\n\n" +
                    "Files:\t//depot/testArea/myEdit.txt\t# edit\n\n" +
                    "Raw:\tvalue"
            );
        });
        it("Uses the raw value for a high-level field when not supplied", async () => {
            execute.callsFake(execWithStdOut("Change 1234 updated."));
            const changeSpec: ChangeSpec = {
                description: undefined,
                change: "1234",
                files: [{ depotPath: "//depot/testArea/myEdit.txt", action: "edit" }],
                rawFields: [{ name: "Description", value: ["override"] }]
            };
            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.deep.equal({
                rawOutput: "Change 1234 updated.",
                chnum: "1234"
            });

            expect(execute).to.have.been.calledWithMatch(
                ws,
                "change",
                sinon.match.any,
                ["-i"],
                null,
                "Change:\t1234\n\n" +
                    "Files:\t//depot/testArea/myEdit.txt\t# edit\n\n" +
                    "Description:\toverride"
            );
        });
        it("Throws an error on stderr", async () => {
            execute.callsFake(execWithStdErr("Your spec is terrible."));
            const changeSpec: ChangeSpec = {
                description: undefined,
                change: "1234",
                files: [{ depotPath: "//depot/testArea/myEdit.txt", action: "edit" }],
                rawFields: [{ name: "Description", value: ["override"] }]
            };

            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.be.rejectedWith("Your spec is terrible.");
        });
    });
    describe("fstat", () => {
        it("Uses the correct arguments", async () => {
            execute.callsFake(execWithStdOut(""));
            await p4.getFstatInfo(ws, {
                depotPaths: ["a", "b", "c"],
                chnum: "99",
                limitToShelved: true,
                outputPendingRecord: true
            });

            expect(execute).to.have.been.calledWith(ws, "fstat", sinon.match.any, [
                "-e",
                "99",
                "-Or",
                "-Rs",
                "a",
                "b",
                "c"
            ]);
        });
        it("Returns fstat info in the same order as the input, ignoring stderr", async () => {
            execute.callsFake(
                execWithResult(
                    null,
                    "... depotFile //depot/testArea/ilikenewfiles\n" +
                        "... clientFile /home/perforce/depot/testArea/newPlace/ilikenewfiles\n" +
                        "... isMapped \n" +
                        "... headAction add\n" +
                        "... headType text\n" +
                        "... headTime 1581622617\n" +
                        "... headRev 1\n" +
                        "... headChange 38\n" +
                        "... headModTime 1581622605\n" +
                        "... haveRev 1\n" +
                        "\n" +
                        "... depotFile //depot/testArea/ireallylikenewfiles\n" +
                        "... clientFile /home/perforce/depot/testArea/newPlace/ireallylikenewfiles\n" +
                        "... isMapped \n" +
                        "... headAction add\n" +
                        "... headType text\n" +
                        "... headTime 1581622799\n" +
                        "... headRev 1\n" +
                        "... headChange 38\n" +
                        "... headModTime 1581622774\n" +
                        "... haveRev 1\n" +
                        "\n" +
                        "... depotFile //depot/testArea/stuff\n" +
                        "... clientFile /home/perforce/depot/testArea/stuff\n" +
                        "... isMapped \n" +
                        "... headAction add\n" +
                        "... headType text\n" +
                        "... headTime 1581023705\n" +
                        "... headRev 1\n" +
                        "... headChange 38\n" +
                        "... headModTime 1580943006\n" +
                        "... haveRev 1\n",
                    "//depot/testArea/filewithnooutput - no such file"
                )
            );

            const output = await p4.getFstatInfo(ws, {
                chnum: "38",
                depotPaths: [
                    "//depot/testArea/ireallylikenewfiles",
                    "//depot/testArea/ilikenewfiles",
                    "//depot/testArea/filewithnooutput"
                ]
            });

            expect(output).to.have.length(3);
            expect(output[0]).to.deep.include({
                depotFile: "//depot/testArea/ireallylikenewfiles",
                clientFile: "/home/perforce/depot/testArea/newPlace/ireallylikenewfiles",
                isMapped: "true"
            });
            expect(output[1]).to.deep.include({
                depotFile: "//depot/testArea/ilikenewfiles",
                clientFile: "/home/perforce/depot/testArea/newPlace/ilikenewfiles",
                isMapped: "true"
            });
            expect(output[2]).to.be.undefined;
        });
        it("Uses multiple fstat commands if necessary", async () => {
            const paths = Array.from({ length: 35 }, (x, i) => "//depot/f" + i);

            execute.onFirstCall().callsFake(
                execWithStdOut(
                    paths
                        .slice(0, 32)
                        .map(path => "... depotFile " + path)
                        .join("\n\n")
                )
            );
            execute.onSecondCall().callsFake(
                execWithStdOut(
                    paths
                        .slice(32)
                        .map(path => "... depotFile " + path)
                        .join("\n\n")
                )
            );

            const expected = paths.map(path => {
                return { depotFile: path };
            });

            const firstPortion = paths.slice(0, 32);
            const secondPortion = paths.slice(32);

            await expect(
                p4.getFstatInfo(ws, { depotPaths: paths })
            ).to.eventually.deep.equal(expected);

            expect(execute).to.have.been.calledWith(
                ws,
                "fstat",
                sinon.match.any,
                firstPortion
            );
            expect(execute).to.have.been.calledWith(
                ws,
                "fstat",
                sinon.match.any,
                secondPortion
            );
        });
    });
    describe("get opened files", () => {
        it("Returns the list of opened files", async () => {
            execute.callsFake(
                execWithStdOut(
                    "//depot/testArea/anotherfile#1 - move/delete change 35 (text) by super@matto\n" +
                        "//depot/testArea/anotherfile-moved#1 - move/add change 35 (text) by super@matto"
                )
            );
            await expect(p4.getOpenedFiles(ws, { chnum: "3" })).to.eventually.eql([
                "//depot/testArea/anotherfile",
                "//depot/testArea/anotherfile-moved"
            ]);
            expect(execute).to.have.been.calledWith(ws, "opened", sinon.match.any, [
                "-c",
                "3"
            ]);
        });
        it("Does not throw on stderr", async () => {
            execute.callsFake(execWithStdErr("no open files"));
            await expect(p4.getOpenedFiles(ws, {})).to.eventually.eql([]);
        });
    });
    describe("submit", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.submitChangelist(ws, { chnum: "1", description: "my description" })
            ).to.eventually.equal("submit -c 1 -d my description");
        });
    });
    describe("revert", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.revert(ws, {
                    unchanged: true,
                    chnum: "1",
                    paths: [{ fsPath: "c:\\my f#ile.txt" }]
                })
            ).to.eventually.equal("revert -a -c 1 c:\\my f%23ile.txt");
        });
    });
    describe("shelve", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.shelve(ws, {
                    delete: true,
                    force: true,
                    chnum: "99",
                    paths: ["myfile.txt"]
                })
            ).to.eventually.equal("shelve -f -d -c 99 myfile.txt");
        });
    });
    describe("unshelve", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.unshelve(ws, {
                    shelvedChnum: "99",
                    toChnum: "1",
                    force: true,
                    paths: ["myfile.txt"]
                })
            ).to.eventually.equal("unshelve -f -s 99 -c 1 myfile.txt");
        });
    });
    describe("fix job", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.fixJob(ws, {
                    chnum: "123456",
                    jobId: "job000001",
                    removeFix: true
                })
            ).to.eventually.equal("fix -c 123456 -d job000001");
        });
    });
    describe("reopen", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.reopenFiles(ws, {
                    chnum: "default",
                    files: ["a.txt", "b.txt"]
                })
            ).to.eventually.equal("reopen -c default a.txt b.txt");
        });
    });
    describe("sync", () => {
        it("uses the correct arguments", async () => {
            await expect(p4.sync(ws, {})).to.eventually.equal("sync");
        });
    });
    describe("getChangelists", () => {
        it("Returns the list of open changelists", async () => {
            execute.callsFake(
                execWithStdOut(
                    "Change 2148153 on 2020/01/21 by user3@client 'Update things'\n" +
                        "Change 2148152 on 2020/01/20 by user2@client *pending* 'Do some updates '\n" +
                        "Change 2148150 on 2020/01/12 by user1@client *pending* 'Update more things'"
                )
            );

            await expect(
                p4.getChangelists(ws, {
                    client: "client",
                    status: p4.ChangelistStatus.PENDING
                })
            ).to.eventually.deep.equal([
                {
                    chnum: "2148153",
                    date: "2020/01/21",
                    user: "user3",
                    client: "client",
                    status: undefined,
                    description: "Update things"
                },
                {
                    chnum: "2148152",
                    date: "2020/01/20",
                    user: "user2",
                    client: "client",
                    status: "pending",
                    description: "Do some updates "
                },
                {
                    chnum: "2148150",
                    date: "2020/01/12",
                    user: "user1",
                    client: "client",
                    status: "pending",
                    description: "Update more things"
                }
            ] as ChangeInfo[]);

            expect(execute).to.have.been.calledWith(ws, "changes", sinon.match.any, [
                "-c",
                "client",
                "-s",
                "pending"
            ]);
        });
    });
    describe("getShelvedFiles", () => {
        it("Returns the list of shelved files", async () => {
            execute.callsFake(
                execWithStdOut(
                    "Change 123 by user@cli on 2020/01/22 10:38:30 *pending*\n" +
                        "\n" +
                        "\tNot sure what I'm doing\n" +
                        "\n" +
                        "Shelved files ...\n" +
                        "\n" +
                        "\n" +
                        "Change 456 by user@cli on 2016/09/16 11:40:19 *pending*\n" +
                        "\n" +
                        "\tUpdate stuff\n" +
                        "\n" +
                        "Jobs fixed ...\n" +
                        "\n" +
                        "job000001 on 2016/09/27 by Bob.Bobson *closed*\n" +
                        "\n" +
                        "\tDo something good\n" +
                        "\n" +
                        "Shelved files ...\n" +
                        "\n" +
                        "... //depot/testArea/file1#7 edit\n" +
                        "... //depot/testArea/file2.cc#12 edit\n" +
                        "\n" +
                        "Change 789 by user@cli on 2016/09/16 11:30:19 *pending*\n" +
                        "\n" +
                        "\tUpdate stuff\n" +
                        "\n" +
                        "Shelved files ...\n" +
                        "\n" +
                        "... //depot/testArea/file3#7 move/delete\n" +
                        "... //depot/testArea/file4.cc#1 move/add\n" +
                        "\n"
                )
            );

            await expect(
                p4.getShelvedFiles(ws, { chnums: ["123", "456", "789"] })
            ).to.eventually.deep.equal([
                {
                    chnum: 456,
                    paths: ["//depot/testArea/file1", "//depot/testArea/file2.cc"]
                },
                {
                    chnum: 789,
                    paths: ["//depot/testArea/file3", "//depot/testArea/file4.cc"]
                }
            ] as p4.ShelvedChangeInfo[]);

            expect(execute).to.have.been.calledWith(ws, "describe", sinon.match.any, [
                "-S",
                "-s",
                "123",
                "456",
                "789"
            ]);
        });
    });
    describe("fixedJobs", () => {
        it("Returns the list of jobs fixed by a changelist", async () => {
            execute.callsFake(
                execWithStdOut(
                    "Change 456 by user@cli on 2016/09/16 11:40:19 *pending*\n" +
                        "\n" +
                        "\tUpdate stuff\n" +
                        "\n" +
                        "Jobs fixed ...\n" +
                        "\n" +
                        "job00001 on 2016/09/27 by Bob.Bobson *closed*\n" +
                        "\n" +
                        "\tDo something good\n" +
                        "\n" +
                        "job00002 on 2016/09/27 by Bob.Bobson *closed*\n" +
                        "\n" +
                        "\tDo something better\n" +
                        "\tAnd do it over multiple lines\n" +
                        "\n" +
                        "Shelved files ...\n" +
                        "\n" +
                        "... //depot/testArea/file1#7 edit\n" +
                        "... //depot/testArea/file2.cc#12 edit\n" +
                        "\n"
                )
            );

            await expect(p4.getFixedJobs(ws, { chnum: "456" })).to.eventually.deep.equal([
                { description: ["Do something good"], id: "job00001" },
                {
                    description: ["Do something better", "And do it over multiple lines"],
                    id: "job00002"
                }
            ] as FixedJob[]);

            expect(execute).to.have.been.calledWith(ws, "describe", sinon.match.any, [
                "-s",
                "456"
            ]);
        });
    });
    describe("info", () => {
        it("Returns a map of info fields", async () => {
            execute.callsFake(
                execWithStdOut(
                    "User name: user\n" +
                        "Client name: cli\n" +
                        "Client host: skynet\n" +
                        "Client root: /home/user/perforce\n" +
                        "Current directory: /home/user/perforce/sub\n"
                )
            );

            const output = await p4.getInfo(ws, {});
            expect(output.get("User name")).to.equal("user");
            expect(output.get("Client name")).to.equal("cli");
            expect(output.get("Client host")).to.equal("skynet");
            expect(output.get("Client root")).to.equal("/home/user/perforce");
            expect(output.get("Current directory")).to.equal("/home/user/perforce/sub");

            expect(execute).to.have.been.calledWith(ws, "info");
        });
    });
    describe("have file", () => {
        it("Uses the correct arguments", async () => {
            await p4.haveFile(ws, { file: "//depot/testArea/myFile.txt" }); // TODO local path
            expect(execute).to.have.been.calledWith(ws, "have", sinon.match.any, [
                "//depot/testArea/myFile.txt"
            ]);
        });
        it("Returns true if stdout has output", async () => {
            execute.callsFake(
                execWithStdOut(
                    "//depot/testArea/Makefile#4 - /home/peforce/TestArea/Makefile"
                )
            );
            await expect(p4.haveFile(ws, { file: "/home/peforce/TestArea/Makefile" })).to
                .eventually.be.true;
        });
        it("Returns false if stderr has output", async () => {
            execute.callsFake(
                execWithStdErr("//depot/testArea/Makefile#4 - no such file")
            );
            await expect(p4.haveFile(ws, { file: "/home/peforce/TestArea/Makefile" })).to
                .eventually.be.false;
        });
        it("Throws on error", async () => {
            execute.callsFake(execWithErr(new Error("oh no")));
            await expect(
                p4.haveFile(ws, { file: "/home/peforce/TestArea/Makefile" })
            ).to.eventually.be.rejectedWith("oh no");
        });
    });
    describe("isLoggedIn", () => {
        it("Returns true on stdout", async () => {
            execute.callsFake(execWithStdOut("login ok"));
            await expect(p4.isLoggedIn(ws)).to.eventually.equal(true);
        });
        it("Returns false on stderr", async () => {
            execute.callsFake(execWithStdErr("not logged in"));
            await expect(p4.isLoggedIn(ws)).to.eventually.equal(false);
        });
        it("Returns false on err", async () => {
            execute.callsFake(execWithErr(new Error("oh no")));
            await expect(p4.isLoggedIn(ws)).to.eventually.equal(false);
        });
    });
    describe("login", () => {
        it("uses the correct arguments", async () => {
            await p4.login(ws, { password: "hunter2" });
            expect(execute).to.have.been.calledWith(
                ws,
                "login",
                sinon.match.any,
                [],
                null,
                "hunter2"
            );
        });
        it("Throws on stderr", async () => {
            execute.callsFake(execWithStdErr("bad password"));
            await expect(
                p4.login(ws, { password: "hunter3" })
            ).to.eventually.be.rejectedWith("bad password");
        });
        it("Throws on err", async () => {
            execute.callsFake(execWithErr(new Error("more bad password")));
            await expect(
                p4.login(ws, { password: "hunter4" })
            ).to.eventually.be.rejectedWith("more bad password");
        });
    });
    describe("logout", () => {
        it("uses the correct arguments", async () => {
            await expect(p4.logout(ws, {})).to.eventually.equal("logout");
        });
    });
});
