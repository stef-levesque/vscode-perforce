import { expect } from "chai";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

import * as vscode from "vscode";

import sinon from "sinon";
import * as PerforceUri from "../../PerforceUri";
import { Status } from "../../scm/Status";
import p4Commands from "../helpers/p4Commands";
import { StubPerforceModel, StubFile } from "../helpers/StubPerforceModel";
import * as DiffProvider from "../../DiffProvider";

import { getLocalFile, getWorkspaceUri } from "../helpers/testUtils";
import Sinon from "sinon";
import { Display } from "../../Display";
import { HaveFile } from "../../api/PerforceApi";

chai.use(sinonChai);
chai.use(p4Commands);
chai.use(chaiAsPromised);

describe("Diff Provider", () => {
    if (!vscode.workspace.workspaceFolders?.[0]) {
        throw new Error("No workspace folders open");
    }
    const workspaceUri = getWorkspaceUri();

    const basicFiles: { [key: string]: () => StubFile } = {
        edit: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "a.txt"),
                depotPath: "//depot/testArea/testFolder/a.txt",
                depotRevision: 4,
                operation: Status.EDIT
            };
        }
    };

    let showImportantError: Sinon.SinonSpy<any>;
    let stubModel: StubPerforceModel;
    let execCommand: Sinon.SinonStub<any>;
    beforeEach(() => {
        stubModel = new StubPerforceModel();
        execCommand = sinon.stub(vscode.commands, "executeCommand");
        showImportantError = sinon.stub(Display, "showImportantError");
    });
    afterEach(() => {
        sinon.restore();
    });
    describe("diffTitleForDepotPaths", () => {
        it("Returns a title showing the names and revisions for two paths", () => {
            const path = "//depot/main/file1.txt";
            const rev1 = "2";
            const rev2 = "3";
            expect(DiffProvider.diffTitleForDepotPaths(path, rev1, path, rev2)).to.equal(
                "file1.txt#2 ⟷ file1.txt#3"
            );
        });
        it("Includes all parts of the filename that are not common between the two", () => {
            const path1 = "//depot/main/file1.txt";
            const path2 = "//depot/branches/branch1/file1.txt";
            const rev1 = "2";
            const rev2 = "1";
            expect(
                DiffProvider.diffTitleForDepotPaths(path1, rev1, path2, rev2)
            ).to.equal("main/file1.txt#2 ⟷ branches/branch1/file1.txt#1");
        });
    });
    describe("diffFiles", () => {
        it("Diffs the supplied URIs, adding information about the starting & left file", async () => {
            const right = basicFiles.edit().localFile;
            const left = PerforceUri.fromUriWithRevision(right, "2");

            const expectedRight = PerforceUri.withArgs(right, {
                leftUri: left.toString(),
                diffStartFile: right.toString()
            });

            await DiffProvider.diffFiles(left, right);

            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                left,
                expectedRight,
                "a.txt#2 ⟷ a.txt"
            );
        });
        it("Does not replace an existing starting file", async () => {
            const localFile = basicFiles.edit().localFile;
            const right = PerforceUri.withArgs(
                PerforceUri.fromDepotPath(
                    basicFiles.edit().localFile,
                    basicFiles.edit().depotPath,
                    "4"
                ),
                { diffStartFile: localFile.toString() }
            );
            const left = PerforceUri.fromUriWithRevision(right, "3");
            const expectedRight = PerforceUri.withArgs(right, {
                leftUri: left.toString()
            });

            await DiffProvider.diffFiles(left, right);

            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                left,
                expectedRight,
                "a.txt#3 ⟷ a.txt#4"
            );
        });
        it("Uses a pre-supplied title if supplied", async () => {
            const right = basicFiles.edit().localFile;
            const left = PerforceUri.fromUriWithRevision(right, "2");

            const expectedRight = PerforceUri.withArgs(right, {
                leftUri: left.toString(),
                diffStartFile: right.toString()
            });

            await DiffProvider.diffFiles(left, right);

            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                left,
                expectedRight,
                "a.txt#2 ⟷ a.txt"
            );
        });
        it("Does not stack the left file from previous diffs", async () => {
            const { localFile, depotPath } = basicFiles.edit();
            const left = PerforceUri.withArgs(
                PerforceUri.fromDepotPath(localFile, depotPath, "3"),
                {
                    leftUri: PerforceUri.fromDepotPath(
                        localFile,
                        depotPath,
                        "2"
                    ).toString()
                }
            );
            const right = PerforceUri.fromDepotPath(localFile, depotPath, "4");
            const expectedLeft = PerforceUri.withArgs(left, { leftUri: undefined });
            const expectedRight = PerforceUri.withArgs(right, {
                leftUri: expectedLeft.toString()
            });

            await DiffProvider.diffFiles(left, right);

            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                expectedLeft,
                expectedRight,
                "a.txt#3 ⟷ a.txt#4"
            );
        });
    });
    describe("diffPrevious", () => {
        describe("When the URI contains info about the left hand file", () => {
            it("Diffs the left file against left - 1", async () => {
                const { localFile, depotPath } = basicFiles.edit();
                const curLeft = PerforceUri.withArgs(
                    PerforceUri.fromDepotPath(localFile, depotPath, "2"),
                    { haveRev: "4" }
                );
                const from = PerforceUri.withArgs(localFile, {
                    leftUri: curLeft.toString(),
                    haveRev: "4"
                });

                const expectedLeft = PerforceUri.fromUriWithRevision(curLeft, "1");
                const expectedRight = PerforceUri.withArgs(curLeft, {
                    leftUri: expectedLeft.toString()
                });

                await DiffProvider.diffPrevious(from);

                expect(execCommand.lastCall).to.be.vscodeDiffCall(
                    expectedLeft,
                    expectedRight,
                    "a.txt#1 ⟷ a.txt#2"
                );
            });
            it("Shows an error if the current left revision is <= 1", async () => {
                const { localFile, depotPath } = basicFiles.edit();
                const curLeft = PerforceUri.withArgs(
                    PerforceUri.fromDepotPath(localFile, depotPath, "1"),
                    { haveRev: "4" }
                );
                const from = PerforceUri.withArgs(localFile, {
                    leftUri: curLeft.toString(),
                    haveRev: "4"
                });

                await DiffProvider.diffPrevious(from);
                expect(showImportantError).to.have.been.calledWithMatch(
                    "No previous revision"
                );
                expect(execCommand).not.to.have.been.called;
            });
        });
        describe("When the URI fragment is not a revision", () => {
            it("Finds and diffs against the have revision, supplying a haveRev arg", async () => {
                const { localFile, depotPath } = basicFiles.edit();
                const have: HaveFile = {
                    localUri: localFile,
                    depotPath: depotPath,
                    revision: "4",
                    depotUri: PerforceUri.fromDepotPath(localFile, depotPath, "4")
                };
                stubModel.have.resolves(have);

                const expectedLeft = PerforceUri.withArgs(have.depotUri, {
                    haveRev: "4"
                });
                const expectedRight = PerforceUri.withArgs(localFile, {
                    haveRev: "4",
                    leftUri: expectedLeft.toString(),
                    diffStartFile: localFile.toString()
                });

                await DiffProvider.diffPrevious(localFile);

                expect(execCommand.lastCall).to.be.vscodeDiffCall(
                    expectedLeft,
                    expectedRight,
                    "a.txt#4 ⟷ a.txt (workspace)"
                );
            });
            it("Shows an error if there is no have revision", async () => {
                const { localFile } = basicFiles.edit();
                stubModel.have.resolves(undefined);

                await DiffProvider.diffPrevious(localFile);
                expect(showImportantError).to.have.been.calledWithMatch(
                    "No previous revision"
                );
                expect(execCommand).not.to.have.been.called;
            });
        });
        describe("When the URI fragment contains a revision number", () => {
            it("Diffs against the previous revision", async () => {
                const { localFile } = basicFiles.edit();

                const from = PerforceUri.fromUriWithRevision(localFile, "4");

                await DiffProvider.diffPrevious(from);

                const expectedLeft = PerforceUri.fromUriWithRevision(localFile, "3");
                const expectedRight = PerforceUri.withArgs(
                    PerforceUri.fromUriWithRevision(localFile, "4"),
                    {
                        leftUri: expectedLeft.toString(),
                        diffStartFile: from.toString()
                    }
                );

                expect(execCommand.lastCall).to.be.vscodeDiffCall(
                    expectedLeft,
                    expectedRight,
                    "a.txt#3 ⟷ a.txt#4"
                );
            });
            it("Shows an error if the previous revision is <= 0", async () => {
                const { localFile } = basicFiles.edit();

                const from = PerforceUri.fromUriWithRevision(localFile, "1");

                await DiffProvider.diffPrevious(from);

                expect(showImportantError).to.have.been.calledWithMatch(
                    "No previous revision"
                );
                expect(execCommand).not.to.have.been.called;
            });
        });
    });
    describe("diffNext", () => {
        it("Does not diff files without a revision", async () => {
            await DiffProvider.diffNext(basicFiles.edit().localFile);
            expect(showImportantError).to.have.been.calledWithMatch("No more revisions");
            expect(execCommand).not.to.have.been.called;
        });
        it("Diffs against the supplied revision + 1", async () => {
            const { localFile, depotPath } = basicFiles.edit();
            const from = PerforceUri.fromDepotPath(localFile, depotPath, "4");

            const expectedLeft = from;
            const expectedRight = PerforceUri.withArgs(
                from,
                { leftUri: expectedLeft.toString() },
                "5"
            );

            await DiffProvider.diffNext(from);

            expect(execCommand.lastCall).to.be.vscodeDiffCall(
                expectedLeft,
                expectedRight,
                "a.txt#4 ⟷ a.txt#5"
            );
        });
        describe("When the next revision is greater than the have revision", () => {
            it("Diffs against the starting file, if one is supplied", async () => {
                const { localFile, depotPath } = basicFiles.edit();
                const from = PerforceUri.withArgs(
                    PerforceUri.fromDepotPath(localFile, depotPath, "4"),
                    {
                        haveRev: "4",
                        diffStartFile: localFile.toString()
                    }
                );

                const expectedLeft = from;
                const expectedRight = PerforceUri.withArgs(
                    localFile,
                    {
                        leftUri: expectedLeft.toString()
                    },
                    ""
                );

                await DiffProvider.diffNext(from);

                expect(execCommand.lastCall).to.be.vscodeDiffCall(
                    expectedLeft,
                    expectedRight,
                    "a.txt#4 ⟷ a.txt (workspace)"
                );
            });
        });
    });
});
