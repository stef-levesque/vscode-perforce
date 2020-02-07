import { expect } from "chai";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as sinonChai from "sinon-chai";

import * as vscode from "vscode";

import * as sinon from "sinon";
import { IPerforceConfig } from "../../PerforceService";
import { PerforceSCMProvider } from "../../ScmProvider";
import { PerforceContentProvider } from "../../ContentProvider";
import {
    StubPerforceService,
    StubFile,
    getLocalFile,
    returnStdErr
} from "./StubPerforceService";
import { Display } from "../../Display";
import { Utils } from "../../Utils";
import * as path from "path";
import { Resource } from "../../scm/Resource";
import { Status } from "../../scm/Status";
import p4Commands from "../helpers/p4Commands";
import { WorkspaceConfigAccessor } from "../../ConfigService";

chai.use(sinonChai);
chai.use(p4Commands);
chai.use(chaiAsPromised);

interface TestItems {
    instance: PerforceSCMProvider;
    stubService: StubPerforceService;
    execute: sinon.SinonStub<
        [
            vscode.Uri,
            string,
            (err: Error | null, stdout: string, stderr: string) => void,
            (string | undefined)?,
            (string | null | undefined)?,
            (string | undefined)?
        ],
        void
    >;
    showMessage: sinon.SinonSpy<[string], void>;
    showModalMessage: sinon.SinonSpy<[string], void>;
    showError: sinon.SinonSpy<[string], void>;
    showImportantError: sinon.SinonSpy<[string], void>;
    refresh: sinon.SinonSpy;
}

function timeout(ms: number) {
    return new Promise(res => {
        setTimeout(() => res(), ms);
    });
}

function findResourceForShelvedFile(
    group: vscode.SourceControlResourceGroup,
    file: StubFile
) {
    const res = group.resourceStates.find(
        resource =>
            (resource as Resource).isShelved &&
            Utils.getDepotPathFromDepotUri(resource.resourceUri) === file.depotPath
    );
    if (res === undefined) {
        throw new Error("No shelved resource found");
    }
    return res;
}

function findResourceForFile(group: vscode.SourceControlResourceGroup, file: StubFile) {
    const res = group.resourceStates.find(
        resource =>
            !(resource as Resource).isShelved &&
            (resource as Resource).resourceUri.fsPath === file.localFile?.fsPath
    );
    if (res === undefined) {
        throw new Error("No resource found");
    }
    return res;
}

describe("Model & ScmProvider modules (integration)", () => {
    if (!vscode.workspace.workspaceFolders?.[0]) {
        throw new Error("No workspace folders open");
    }
    const workspaceUri = vscode.workspace.workspaceFolders[0].uri;

    const basicFiles = {
        edit: {
            localFile: getLocalFile(workspaceUri, "testFolder", "a.txt"),
            depotPath: "//depot/testArea/testFolder/a.txt",
            depotRevision: 1,
            operation: Status.EDIT
        },
        delete: {
            localFile: getLocalFile(workspaceUri, "testFolder", "deleted.txt"),
            depotPath: "//depot/testArea/testFolder/deleted.txt",
            depotRevision: 2,
            operation: Status.DELETE
        },
        add: {
            localFile: getLocalFile(workspaceUri, "testFolder", "new.txt"),
            depotPath: "//depot/testArea/testFolder/new.txt",
            depotRevision: 3,
            operation: Status.ADD
        },
        moveAdd: {
            localFile: getLocalFile(workspaceUri, "testFolder", "moved.txt"),
            depotPath: "//depot/testArea/testFolder/moved.txt",
            depotRevision: 1,
            operation: Status.MOVE_ADD,
            resolveFromDepotPath: "//depot/testArea/testFolderOld/movedFrom.txt"
        },
        moveDelete: {
            localFile: getLocalFile(workspaceUri, "testFolderOld", "movedFrom.txt"),
            depotPath: "//depot/testArea/testFolderOld/movedFrom.txt",
            depotRevision: 3,
            operation: Status.MOVE_DELETE
        },
        branch: {
            localFile: getLocalFile(workspaceUri, "testFolder", "branched.txt"),
            depotPath: "//depot/testArea/testFolder/branched.txt",
            depotRevision: 1,
            operation: Status.BRANCH,
            resolveFromDepotPath: "//depot/testAreaOld/testFolder/branchedFrom.txt"
        },
        integrate: {
            localFile: getLocalFile(workspaceUri, "testFolder", "integrated.txt"),
            depotPath: "//depot/testArea/testFolder/integrated.txt",
            depotRevision: 7,
            operation: Status.INTEGRATE,
            resolveFromDepotPath: "//depot/testAreaOld/testFolder/integrated.txt"
        },
        outOfWorkspaceAdd: {
            localFile: getLocalFile(workspaceUri, "..", "outOfWorkspaceAdd.txt"),
            depotPath: "//depot/outOfWorkspaceAdd.txt",
            depotRevision: 1,
            operation: Status.ADD
        },
        outOfWorkspaceEdit: {
            localFile: getLocalFile(workspaceUri, "..", "outOfWorkspace.txt"),
            depotPath: "//depot/outOfWorkspace.txt",
            depotRevision: 99,
            operation: Status.EDIT
        },
        shelveNoWorkspace: {
            depotPath: "//depot/testArea/testFolder/none.txt",
            localFile: getLocalFile(workspaceUri, "testFolder", "none.txt"),
            depotRevision: 1,
            operation: Status.ADD
        },
        shelveEdit: {
            localFile: getLocalFile(workspaceUri, "testFolder", "a.txt"),
            depotPath: "//depot/testArea/testFolder/a.txt",
            depotRevision: 1,
            operation: Status.EDIT
        },
        shelveDelete: {
            localFile: getLocalFile(workspaceUri, "testFolder", "deleted.txt"),
            depotPath: "//depot/testArea/testFolder/deleted.txt",
            depotRevision: 2,
            operation: Status.DELETE
        }
    };

    const localDir = Utils.normalize(workspaceUri.fsPath) + "/";

    const config: IPerforceConfig = {
        localDir,
        p4Client: "cli",
        p4User: "user"
    };

    let items: TestItems;
    let subscriptions: vscode.Disposable[] = [];

    const doc = new PerforceContentProvider("perforce");

    before(async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
    after(() => {
        doc.dispose();
    });
    describe("Refresh / Initialize", function() {
        let stubService: StubPerforceService;
        let instance: PerforceSCMProvider;
        let workspaceConfig: WorkspaceConfigAccessor;
        this.beforeEach(function() {
            this.timeout(4000);

            stubService = new StubPerforceService();
            stubService.changelists = [];
            stubService.stubExecute();

            workspaceConfig = new WorkspaceConfigAccessor(workspaceUri);

            // save time on refresh function calls
            sinon.stub(workspaceConfig, "refreshDebounceTime").get(() => 100);

            instance = new PerforceSCMProvider(
                config,
                workspaceUri,
                workspaceConfig,
                "perforce"
            );
            subscriptions.push(instance);
        });
        this.afterEach(() => {
            subscriptions.forEach(sub => sub.dispose());
            sinon.restore();
        });
        it("Handles no changelists", async () => {
            stubService.changelists = [];

            await instance.Initialize();
            expect(instance.resources).to.have.lengthOf(1);
            expect(instance.resources[0].resourceStates).to.be.resources([]);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
        });
        it("Handles changelists with no open files", async () => {
            stubService.changelists = [
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: []
                }
            ];
            await instance.Initialize();
            expect(instance.resources).to.have.lengthOf(2);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
            expect(instance.resources[0].resourceStates).to.be.resources([]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([]);
        });
        it("Handles open files with no shelved files", async () => {
            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch, basicFiles.outOfWorkspaceEdit]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [
                        basicFiles.edit,
                        basicFiles.delete,
                        basicFiles.add,
                        basicFiles.outOfWorkspaceAdd
                    ]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd, basicFiles.moveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.branch,
                basicFiles.outOfWorkspaceEdit
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.edit,
                basicFiles.delete,
                basicFiles.add,
                basicFiles.outOfWorkspaceAdd
            ]);
            expect(instance.resources[2].id).to.equal("pending:2");
            expect(instance.resources[2].label).to.equal("#2: changelist 2");
            expect(instance.resources[2].resourceStates).to.be.resources([
                basicFiles.moveAdd,
                basicFiles.moveDelete
            ]);
        });
        it("Handles shelved files with no open files", async () => {
            stubService.changelists = [
                {
                    chnum: "3",
                    description: "shelved changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit]
                },
                {
                    chnum: "4",
                    description: "shelved changelist 2",
                    files: [],
                    shelvedFiles: [basicFiles.shelveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:3");
            expect(instance.resources[1].label).to.equal("#3: shelved changelist 1");
            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit
            ]);

            expect(instance.resources[2].id).to.equal("pending:4");
            expect(instance.resources[2].label).to.equal("#4: shelved changelist 2");
            expect(instance.resources[2].resourceStates).to.be.shelvedResources([
                basicFiles.shelveDelete
            ]);
        });
        it("Handles open and shelved files", async () => {
            stubService.changelists = [
                {
                    chnum: "5",
                    description: "mixed changelist 1",
                    files: [basicFiles.edit, basicFiles.add],
                    shelvedFiles: [basicFiles.shelveEdit]
                },
                {
                    chnum: "6",
                    description: "mixed changelist 2",
                    files: [basicFiles.delete],
                    shelvedFiles: [basicFiles.shelveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:5");
            expect(instance.resources[1].label).to.equal("#5: mixed changelist 1");
            expect(
                instance.resources[1].resourceStates.slice(0, 1)
            ).to.be.shelvedResources([basicFiles.shelveEdit]);
            expect(instance.resources[1].resourceStates.slice(1)).to.be.resources([
                basicFiles.edit,
                basicFiles.add
            ]);

            expect(instance.resources[2].id).to.equal("pending:6");
            expect(instance.resources[2].label).to.equal("#6: mixed changelist 2");
            expect(
                instance.resources[2].resourceStates.slice(0, 1)
            ).to.be.shelvedResources([basicFiles.shelveDelete]);
            expect(instance.resources[2].resourceStates.slice(1)).to.be.resources([
                basicFiles.delete
            ]);
        });
        it("Includes new files open for shelve and not in the workspace", async () => {
            stubService.changelists = [
                {
                    chnum: "7",
                    description: "changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveNoWorkspace]
                }
            ];

            await instance.Initialize();

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:7");
            expect(instance.resources[1].label).to.equal("#7: changelist 1");

            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveNoWorkspace
            ]);
        });
        it("Handles the same file shelved in two changelists", async () => {
            stubService.changelists = [
                {
                    chnum: "8",
                    description: "changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit]
                },
                {
                    chnum: "9",
                    description: "changelist 2",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:8");
            expect(instance.resources[1].label).to.equal("#8: changelist 1");

            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit
            ]);

            expect(instance.resources[2].id).to.equal("pending:9");
            expect(instance.resources[2].label).to.equal("#9: changelist 2");

            expect(instance.resources[2].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit
            ]);
        });
        it("Can sort changelists ascending", async () => {
            sinon.stub(workspaceConfig, "changelistOrder").get(() => "ascending");
            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit, basicFiles.delete, basicFiles.add]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd, basicFiles.moveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.branch
            ]);
            expect(instance.resources[1].id).to.equal("pending:2");
            expect(instance.resources[1].label).to.equal("#2: changelist 2");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.moveAdd,
                basicFiles.moveDelete
            ]);
            expect(instance.resources[2].id).to.equal("pending:1");
            expect(instance.resources[2].label).to.equal("#1: changelist 1");
            expect(instance.resources[2].resourceStates).to.be.resources([
                basicFiles.edit,
                basicFiles.delete,
                basicFiles.add
            ]);
        });
        it("Handles shelved files with no open files", async () => {
            stubService.changelists = [
                {
                    chnum: "3",
                    description: "shelved changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit]
                },
                {
                    chnum: "4",
                    description: "shelved changelist 2",
                    files: [],
                    shelvedFiles: [basicFiles.shelveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:3");
            expect(instance.resources[1].label).to.equal("#3: shelved changelist 1");
            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit
            ]);

            expect(instance.resources[2].id).to.equal("pending:4");
            expect(instance.resources[2].label).to.equal("#4: shelved changelist 2");
            expect(instance.resources[2].resourceStates).to.be.shelvedResources([
                basicFiles.shelveDelete
            ]);
        });
        it("Has decorations for files", async () => {
            stubService.changelists = [
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit, basicFiles.delete],
                    shelvedFiles: [basicFiles.shelveEdit, basicFiles.shelveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.resources[1].resourceStates[0].decorations).to.include({
                strikeThrough: false,
                faded: true
            });

            expect(instance.resources[1].resourceStates[1].decorations).to.include({
                strikeThrough: true,
                faded: true
            });

            expect(instance.resources[1].resourceStates[2].decorations).to.include({
                strikeThrough: false,
                faded: false
            });

            expect(instance.resources[1].resourceStates[3].decorations).to.include({
                strikeThrough: true,
                faded: false
            });
        });
        it("Handles more than the max files per command", async () => {
            sinon.stub(workspaceConfig, "maxFilePerCommand").get(() => 1);

            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit, basicFiles.delete, basicFiles.add],
                    shelvedFiles: [basicFiles.shelveDelete, basicFiles.shelveEdit]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd, basicFiles.moveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.branch
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(
                instance.resources[1].resourceStates.slice(0, 2)
            ).to.be.shelvedResources([basicFiles.shelveDelete, basicFiles.shelveEdit]);
            expect(instance.resources[1].resourceStates.slice(2)).to.be.resources([
                basicFiles.edit,
                basicFiles.delete,
                basicFiles.add
            ]);
            expect(instance.resources[2].id).to.equal("pending:2");
            expect(instance.resources[2].label).to.equal("#2: changelist 2");
            expect(instance.resources[2].resourceStates).to.be.resources([
                basicFiles.moveAdd,
                basicFiles.moveDelete
            ]);
        });
        it("Can be refreshed", async () => {
            stubService.changelists = [];
            await instance.Initialize();
            expect(instance.resources).to.have.lengthOf(1);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.edit]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.add]
                }
            ];

            await PerforceSCMProvider.RefreshAll();
            expect(instance.resources).to.have.lengthOf(2);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.edit
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.add
            ]);
        });
        it("Can be refreshed multiple times without duplication", async () => {
            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.edit]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.add]
                }
            ];

            await instance.Initialize();
            await Promise.all([
                PerforceSCMProvider.RefreshAll(),
                PerforceSCMProvider.RefreshAll()
            ]);
            expect(instance.resources).to.have.lengthOf(2);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.edit
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.add
            ]);
        });
        it("Can ignore shelved files", async () => {
            sinon.stub(workspaceConfig, "hideShelvedFiles").get(() => true);

            stubService.changelists = [
                {
                    chnum: "1",
                    description: "mixed changelist 1",
                    files: [basicFiles.add],
                    shelvedFiles: [basicFiles.shelveEdit]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(2);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: mixed changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.add
            ]);
        });
        it("Can hide non-workspace files", async () => {
            sinon.stub(workspaceConfig, "hideNonWorkspaceFiles").get(() => true);

            stubService.changelists = [
                {
                    chnum: "1",
                    description: "mixed changelist 1",
                    files: [
                        basicFiles.add,
                        basicFiles.outOfWorkspaceAdd,
                        basicFiles.outOfWorkspaceEdit
                    ]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(2);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: mixed changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.add
            ]);
        });
        it("Can ignore changelists with a defined prefix", async () => {
            sinon.stub(workspaceConfig, "ignoredChangelistPrefix").get(() => "ignore:");

            stubService.changelists = [
                {
                    chnum: "1",
                    description: "ignore:me",
                    files: [basicFiles.add]
                },
                {
                    chnum: "2",
                    description: "noignore:me",
                    files: [basicFiles.edit]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(2);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:2");
            expect(instance.resources[1].label).to.equal("#2: noignore:me");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.edit
            ]);
        });
        it("Counts open files but not shelved files", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "all-but-shelved");
            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit, basicFiles.delete, basicFiles.add],
                    shelvedFiles: [basicFiles.shelveDelete, basicFiles.shelveEdit]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd, basicFiles.moveDelete] // move add and move delete count as one operation
                }
            ];

            await instance.Initialize();

            expect(instance.count).to.equal(5);
        });
        it("Can count shelved files", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "all");
            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit, basicFiles.delete, basicFiles.add],
                    shelvedFiles: [basicFiles.shelveDelete, basicFiles.shelveEdit]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd, basicFiles.moveDelete] // move add and move delete count as one operation
                }
            ];

            await instance.Initialize();

            expect(instance.count).to.equal(7);
        });
        it("Can disable counting files", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "off");
            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveDelete]
                }
            ];

            await instance.Initialize();

            expect(instance.count).to.equal(0);
        });
        it("Updates the count after refresh", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "all-but-shelved");

            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit, basicFiles.delete, basicFiles.add]
                }
            ];

            await instance.Initialize();
            expect(instance.count).to.equal(4);

            stubService.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch, basicFiles.integrate]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit, basicFiles.delete, basicFiles.add]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd, basicFiles.moveDelete]
                }
            ];
            await PerforceSCMProvider.RefreshAll();
            expect(instance.count).to.equal(6);
        });
    });
    describe("Actions", function() {
        beforeEach(async function() {
            this.timeout(4000);
            const showMessage = sinon.spy(Display, "showMessage");
            const showError = sinon.spy(Display, "showError");

            const stubService = new StubPerforceService();
            stubService.changelists = [
                {
                    chnum: "1",
                    description: "Changelist 1",
                    files: [
                        basicFiles.edit,
                        basicFiles.delete,
                        basicFiles.add,
                        basicFiles.moveAdd,
                        basicFiles.moveDelete,
                        basicFiles.branch,
                        basicFiles.integrate
                    ],
                    shelvedFiles: [basicFiles.shelveEdit, basicFiles.shelveDelete]
                },
                {
                    chnum: "2",
                    description: "Changelist 2",
                    files: [],
                    behaviours: {
                        shelve: returnStdErr("my shelve error"),
                        unshelve: returnStdErr("my unshelve error")
                    }
                },
                {
                    chnum: "3",
                    description: "Changelist 3",
                    submitted: true,
                    files: []
                }
            ];
            const execute = stubService.stubExecute();
            const workspaceConfig = new WorkspaceConfigAccessor(workspaceUri);
            sinon.stub(workspaceConfig, "refreshDebounceTime").get(() => 0);

            const instance = new PerforceSCMProvider(
                config,
                workspaceUri,
                workspaceConfig,
                "perforce"
            );
            subscriptions.push(instance);
            await instance.Initialize();

            const showImportantError = sinon.spy(Display, "showImportantError");
            const showModalMessage = sinon.stub(Display, "showModalMessage"); // stub because modal gets in the way

            const refresh = sinon.spy();

            items = {
                stubService,
                instance,
                execute,
                showMessage,
                showModalMessage,
                showError,
                showImportantError,
                refresh
            };

            subscriptions.push(instance.onRefreshStarted(refresh));
        });
        afterEach(async () => {
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            subscriptions.forEach(sub => sub.dispose());
            subscriptions = [];
            sinon.restore();
        });

        describe("Shelving a changelist", () => {
            it("Cannot shelve the default changelist", async () => {
                await expect(
                    PerforceSCMProvider.ShelveChangelist(items.instance.resources[0])
                ).to.eventually.be.rejectedWith("Cannot shelve the default changelist");
                expect(items.execute).not.to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve"
                );
                await timeout(1);
                expect(items.refresh).not.to.have.been.called;
            });

            it("Can shelve a valid Changelist", async () => {
                await PerforceSCMProvider.ShelveChangelist(items.instance.resources[1]);
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    "-f -c 1"
                );
                expect(items.showMessage).to.have.been.calledOnceWith(
                    "Changelist shelved"
                );
                await timeout(1);
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Can shelve and revert a valid changelist", async () => {
                await PerforceSCMProvider.ShelveRevertChangelist(
                    items.instance.resources[1]
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    "-f -c 1"
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    "-c 1 //..."
                );
                expect(items.showMessage).to.have.been.calledOnceWith(
                    "Changelist shelved"
                );
                await timeout(1);
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Can handle an error when shelving a changelist", async () => {
                await PerforceSCMProvider.ShelveChangelist(items.instance.resources[2]);
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    "-f -c 2"
                );
                expect(items.showMessage).not.to.have.been.called;
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my shelve error"
                );
                await timeout(1);
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Can handle an error when shelving and reverting a changelist", async () => {
                await PerforceSCMProvider.ShelveRevertChangelist(
                    items.instance.resources[2]
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    "-f -c 2"
                );
                expect(items.showMessage).not.to.have.been.called;
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my shelve error"
                );
                expect(items.execute).not.to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert"
                );
                await timeout(1);
                expect(items.refresh).to.have.been.calledOnce;
            });
        });

        describe("Unshelving a changelist", () => {
            it("Can unshelve a valid Changelist", async () => {
                await PerforceSCMProvider.UnshelveChangelist(items.instance.resources[1]);
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "unshelve",
                    sinon.match.any,
                    "-f -s 1"
                );
                expect(items.showMessage).to.have.been.calledOnceWith(
                    "Changelist unshelved"
                );
                await timeout(1);
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Cannot unshelve default changelist", async () => {
                await expect(
                    PerforceSCMProvider.UnshelveChangelist(items.instance.resources[0])
                ).to.eventually.be.rejectedWith("Cannot unshelve the default changelist");
                expect(items.execute).not.to.have.been.calledWithMatch(
                    workspaceUri,
                    "unshelve"
                );
                await timeout(1);
                expect(items.refresh).not.to.have.been.called;
            });

            it("Can handle an error when unshelving a changelist", async () => {
                await PerforceSCMProvider.UnshelveChangelist(items.instance.resources[2]);
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "unshelve",
                    sinon.match.any,
                    "-f -s 2 -c 2"
                );
                expect(items.showMessage).not.to.have.been.called;
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my unshelve error"
                );
                await timeout(1);
                expect(items.refresh).not.to.have.been.called;
            });
        });

        describe("Deleting a shelve", () => {
            it("Deletes a shelved changelist", async () => {
                // accept the warning
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.DeleteShelvedChangelist(
                    items.instance.resources[1]
                );

                expect(warn).to.have.been.calledOnce;
                await timeout(1);
                expect(items.refresh).to.have.been.calledOnce;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    "-d -c 1"
                );
            });

            it("Can cancel deleting a shelved changelist", async () => {
                // close the warning without accepting
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolves(undefined);

                await PerforceSCMProvider.DeleteShelvedChangelist(
                    items.instance.resources[1]
                );

                expect(warn).to.have.been.calledOnce;
                await timeout(1);
                expect(items.refresh).not.to.have.been.called;
                expect(items.execute).not.to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve"
                );
            });

            it("Can handle an error when deleting a shelved changelist", async () => {
                // accept the warning
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.DeleteShelvedChangelist(
                    items.instance.resources[2]
                );

                expect(warn).to.have.been.calledOnce;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    "-d -c 2"
                );
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my shelve error"
                );
                await timeout(1);
                expect(items.refresh).not.to.have.been.called;
            });

            it("Cannot delete from the default changelist", async () => {
                await expect(
                    PerforceSCMProvider.DeleteShelvedChangelist(
                        items.instance.resources[0]
                    )
                ).to.eventually.be.rejectedWith(
                    "Cannot delete shelved files from the default changelist"
                );
                expect(items.execute).not.to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve"
                );
                await timeout(1);
                expect(items.refresh).not.to.have.been.called;
            });
        });

        describe("Deleting a shelved file", () => {
            it("Prompts the user for confirmation", async () => {
                const prompt = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolves(undefined);

                const resource = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete
                );

                await PerforceSCMProvider.DeleteShelvedFile(resource as Resource);

                expect(prompt).to.be.calledOnce;
                expect(items.execute).not.to.have.been.calledWithMatch(
                    sinon.match.any,
                    "shelve"
                );
            });
            it("Deletes the shelved file", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                const resource = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete
                );

                await PerforceSCMProvider.DeleteShelvedFile(resource as Resource);

                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    '-d -c 1 "' + basicFiles.shelveDelete.depotPath + '"'
                );
            });
            it("Can delete multiple shelved files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource1 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete
                );
                const resource2 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit
                );

                await PerforceSCMProvider.DeleteShelvedFile(
                    resource1 as Resource,
                    resource2
                );

                expect(warn).to.have.been.calledTwice;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    '-d -c 1 "' + basicFiles.shelveDelete.depotPath + '"'
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    '-d -c 1 "' + basicFiles.shelveEdit.depotPath + '"'
                );
            });
            it("Cannot be used on normal files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource1 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete
                );
                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add
                );

                await PerforceSCMProvider.DeleteShelvedFile(
                    resource1 as Resource,
                    resource2
                );

                expect(warn).to.have.been.calledOnce;
                expect(items.showImportantError).to.have.been.calledWith(
                    "Shelve cannot be used on normal file: new.txt"
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    '-d -c 1 "' + basicFiles.shelveDelete.depotPath + '"'
                );
                expect(items.execute).not.to.have.been.calledWithMatch(
                    workspaceUri,
                    "shelve",
                    sinon.match.any,
                    "new.txt"
                );
            });
        });

        describe("Opening", () => {
            /**
             * Matches against a perforce URI, containing a local file's path
             * @param file
             */
            function perforceLocalUriMatcher(file: StubFile) {
                if (!file.localFile) {
                    throw new Error(
                        "Can't make a local file matcher without a local file"
                    );
                }
                return Utils.makePerforceDocUri(file.localFile, "print", "-q", {
                    workspace: workspaceUri.fsPath
                });
            }

            /**
             * Matches against a perforce URI, using the depot path for a file
             * @param file
             */
            function perforceDepotUriMatcher(file: StubFile) {
                return Utils.makePerforceDocUri(
                    vscode.Uri.parse("perforce:" + file.depotPath),
                    "print",
                    "-q",
                    { depot: true, workspace: workspaceUri.fsPath }
                );
            }

            /**
             * Matches against a perforce URI, using the resolvedFromFile0 depot path
             * @param file
             */
            function perforceFromFileUriMatcher(file: StubFile) {
                return Utils.makePerforceDocUri(
                    vscode.Uri.parse("perforce:" + file.resolveFromDepotPath),
                    "print",
                    "-q",
                    { depot: true, workspace: workspaceUri.fsPath }
                );
            }

            /**
             * Matches against a perforce URI, using the depot path for the file AND containing a fragment for the shelved changelist number
             * @param file
             * @param chnum
             */
            function perforceShelvedUriMatcher(file: StubFile, chnum: string) {
                return Utils.makePerforceDocUri(
                    vscode.Uri.parse("perforce:" + file.depotPath).with({
                        fragment: "@=" + chnum
                    }),
                    "print",
                    "-q",
                    { depot: true, workspace: workspaceUri.fsPath }
                );
            }

            function perforceLocalShelvedUriMatcher(file: StubFile, chnum: string) {
                if (!file.localFile) {
                    throw new Error(
                        "Can't make a local file matcher without a local file"
                    );
                }
                return Utils.makePerforceDocUri(
                    file.localFile.with({ fragment: "@=" + chnum }),
                    "print",
                    "-q",
                    { workspace: workspaceUri.fsPath }
                );
            }

            let execCommand: sinon.SinonSpy<[string, ...any[]], Thenable<unknown>>;
            beforeEach(function() {
                this.timeout(4000);
                execCommand = sinon.spy(vscode.commands, "executeCommand");
            });

            describe("When opening a file", () => {
                it("Opens the underlying workspace file", async () => {
                    const file = basicFiles.edit;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    expect(resource).not.to.be.undefined;
                    await PerforceSCMProvider.OpenFile(resource);

                    expect(execCommand.lastCall).to.be.vscodeOpenCall(file.localFile);
                });
                it("Can open multiple files", async () => {
                    const file1 = basicFiles.edit;
                    const resource1 = findResourceForFile(
                        items.instance.resources[1],
                        file1
                    );

                    const file2 = basicFiles.add;
                    const resource2 = findResourceForFile(
                        items.instance.resources[1],
                        file2
                    );

                    await PerforceSCMProvider.OpenFile(resource1, resource2);
                    expect(execCommand.getCall(-2)).to.be.vscodeOpenCall(file1.localFile);
                    expect(execCommand.lastCall).to.be.vscodeOpenCall(file2.localFile);
                });
            });
            describe("When opening an scm resource", () => {
                it("Diffs a local file against the depot file", async () => {
                    const file = basicFiles.edit;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceLocalUriMatcher(file),
                        file.localFile,
                        path.basename(file.localFile.path) +
                            " - Diff Workspace (right) Against Most Recent Revision (left)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        file.localFile,
                        "print",
                        sinon.match.any,
                        '-q "' + file.localFile.fsPath + '"'
                    );
                });
                it("Can open multiple resources", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");
                    const file1 = basicFiles.edit;
                    const resource1 = findResourceForFile(
                        items.instance.resources[1],
                        file1
                    );

                    const file2 = basicFiles.delete;
                    const resource2 = findResourceForFile(
                        items.instance.resources[1],
                        file2
                    );

                    await PerforceSCMProvider.Open(resource1, resource2);

                    expect(execCommand.getCall(-1)).to.be.vscodeDiffCall(
                        perforceLocalUriMatcher(file1),
                        file1.localFile,
                        path.basename(file1.localFile.path) +
                            " - Diff Workspace (right) Against Most Recent Revision (left)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        file1.localFile,
                        "print",
                        sinon.match.any,
                        '-q "' + file1.localFile.fsPath + '"'
                    );
                    expect(td.lastCall.args[0]).to.be.p4Uri(
                        perforceLocalUriMatcher(file2)
                    );
                });
                it("Displays the depot version of a deleted file", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");

                    const file = basicFiles.delete;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(td.lastCall.args[0]).to.be.p4Uri(
                        perforceLocalUriMatcher(file)
                    );
                });
                it("Diffs a new file against an empty file", async () => {
                    const file = basicFiles.add;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        vscode.Uri.parse("perforce:EMPTY"),
                        file.localFile,
                        path.basename(file.localFile.path) +
                            " - Diff Workspace (right) Against Most Recent Revision (left)"
                    );
                });
                it("Diffs a moved file against the original file", async () => {
                    const file = basicFiles.moveAdd;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceFromFileUriMatcher(file),
                        file.localFile,
                        path.basename(file.localFile.path) +
                            " - Diff Workspace (right) Against Most Recent Revision (left)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        sinon.match({ fsPath: workspaceUri.fsPath }),
                        "print",
                        sinon.match.any,
                        '-q "' + file.resolveFromDepotPath + '"'
                    );
                });
                it("Displays the depot version for a move / delete", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");

                    const file = basicFiles.moveDelete;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(td.lastCall.args[0]).to.be.p4Uri(
                        perforceLocalUriMatcher(file)
                    );
                });
                it("Diffs a file opened for branch against an empty file", async () => {
                    const file = basicFiles.branch;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        vscode.Uri.parse("perforce:EMPTY"),
                        file.localFile,
                        path.basename(file.localFile.path) +
                            " - Diff Workspace (right) Against Most Recent Revision (left)"
                    );
                });
                it("Diffs an integration/merge against the target depot file", async () => {
                    const file = basicFiles.integrate;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceLocalUriMatcher(file),
                        file.localFile,
                        path.basename(file.localFile.path) +
                            " - Diff Workspace (right) Against Most Recent Revision (left)"
                    );

                    expect(items.execute).to.be.calledWithMatch(
                        file.localFile,
                        "print",
                        sinon.match.any,
                        '-q "' + file.localFile.fsPath + '"'
                    );
                });
                it("Diffs a shelved file against the depot file", async () => {
                    const file = basicFiles.shelveEdit;
                    const resource = findResourceForShelvedFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceDepotUriMatcher(file),
                        perforceShelvedUriMatcher(file, "1"),
                        path.basename(file.localFile.path) +
                            " - Diff Shelve (right) Against Depot Version (left)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        { fsPath: workspaceUri.fsPath },
                        "print",
                        sinon.match.any,
                        '-q "' + file.depotPath + '@=1"'
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        { fsPath: workspaceUri.fsPath },
                        "print",
                        sinon.match.any,
                        '-q "' + file.depotPath + '"'
                    );
                });
                it("Can diff a local file against the shelved file (from the shelved file)", async () => {
                    const file = basicFiles.shelveEdit;
                    const resource = findResourceForShelvedFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.OpenvShelved(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceShelvedUriMatcher(file, "1"),
                        file.localFile,
                        path.basename(file.localFile.path) +
                            " - Diff Workspace (right) Against Shelved Version (left)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        { fsPath: workspaceUri.fsPath },
                        "print",
                        sinon.match.any,
                        '-q "' + file.depotPath + '@=1"'
                    );
                });
                it("Can diff a local file against the shelved file (from the local file)", async () => {
                    const file = basicFiles.shelveEdit;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.OpenvShelved(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceLocalShelvedUriMatcher(file, "1"),
                        file.localFile,
                        path.basename(file.localFile.path) +
                            " - Diff Workspace (right) Against Shelved Version (left)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        file.localFile,
                        "print",
                        sinon.match.any,
                        '-q "' + file.localFile.fsPath + '@=1"'
                    );
                });
                it("Displays the depot version for a shelved deletion", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");
                    const file = basicFiles.shelveDelete;
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(td.lastCall.args[0]).to.be.p4Uri(
                        perforceLocalUriMatcher(file)
                    );
                });
            });
        });
        describe("Save a changelist", () => {
            it("Can save the default changelist", async () => {
                items.instance.sourceControl.inputBox.value =
                    "My new changelist\nline 2\nline 3";
                items.stubService.changelists = [
                    {
                        chnum: "default",
                        files: [basicFiles.add, basicFiles.edit],
                        description: "n/a"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubService.lastChangeInput).to.include({
                    Description: "\tMy new changelist\n\tline 2\n\tline 3",
                    Files:
                        "\t" +
                        basicFiles.add.depotPath +
                        "\t# add" +
                        "\n\t" +
                        basicFiles.edit.depotPath +
                        "\t# edit"
                });
            });
            it("Can save from an empty default changelist", async () => {
                items.instance.sourceControl.inputBox.value = "My new changelist";
                items.stubService.changelists = [
                    {
                        chnum: "default",
                        files: [],
                        description: "n/a"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubService.lastChangeInput).to.include({
                    Description: "\tMy new changelist"
                });
                expect(items.stubService.lastChangeInput).not.to.have.any.keys("Files");
            });
            it("Can change the description of an existing changelist", async () => {
                items.instance.sourceControl.inputBox.value = "#1\nMy updated changelist";
                items.stubService.changelists = [
                    {
                        chnum: "1",
                        files: [basicFiles.add, basicFiles.edit],
                        description: "changelist 1"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubService.lastChangeInput).to.include({
                    Description: "\tMy updated changelist",
                    Files:
                        "\t" +
                        basicFiles.add.depotPath +
                        "\t# add" +
                        "\n\t" +
                        basicFiles.edit.depotPath +
                        "\t# edit"
                });
            });
            it("Can change the description of an empty changelist", async () => {
                items.instance.sourceControl.inputBox.value = "#1\nMy updated changelist";
                items.stubService.changelists = [
                    {
                        chnum: "1",
                        files: [],
                        description: "changelist 1"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubService.lastChangeInput).to.include({
                    Description: "\tMy updated changelist"
                });
                expect(items.stubService.lastChangeInput).not.to.have.any.keys("Files");
            });
        });
        describe("Move files to a changelist", () => {
            it("Displays a selection of changelists to choose from", async () => {
                const quickPick = sinon
                    .stub(vscode.window, "showQuickPick")
                    .resolves(undefined);
                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );

                await PerforceSCMProvider.ReopenFile(resource as Resource);

                const itemArg = quickPick.lastCall.args[0] as vscode.QuickPickItem[];
                expect(itemArg).to.have.lengthOf(4);
                expect(itemArg[0]).to.include({ label: "Default Changelist" });
                expect(itemArg[1]).to.include({
                    label: "New Changelist..."
                });
                expect(itemArg[2]).to.include({
                    label: "#1",
                    description: "Changelist 1"
                });
                expect(itemArg[3]).to.include({
                    label: "#2",
                    description: "Changelist 2"
                });

                expect(items.execute).not.to.have.been.calledWith(
                    sinon.match.any,
                    "reopen"
                );
            });
            it("Can move files to a changelist", async () => {
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[3]);
                });
                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );
                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource, resource2);

                // TODO this shouldn't need to be many commands!!
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "reopen",
                    sinon.match.any,
                    '-c 2 "' + basicFiles.edit.localFile.fsPath + '"'
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "reopen",
                    sinon.match.any,
                    '-c 2 "' + basicFiles.add.localFile.fsPath + '"'
                );
            });
            it("Can move files to the default changelist", async () => {
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });
                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource);

                // TODO this shouldn't need to be many commands
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "reopen",
                    sinon.match.any,
                    '-c default "' + basicFiles.edit.localFile.fsPath + '"'
                );
            });
            it("Can move files to a new changelist", async () => {
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[1]);
                });
                sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves("My selective changelist\nLine 2\nLine 3");
                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );
                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource, resource2);

                expect(items.stubService.lastChangeInput).to.include({
                    Description: "\tMy selective changelist\n\tLine 2\n\tLine 3"
                });

                // TODO this shouldn't need to be many commands
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "reopen",
                    sinon.match.any,
                    '-c 99 "' + basicFiles.edit.localFile.fsPath + '"'
                );

                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "reopen",
                    sinon.match.any,
                    '-c 99 "' + basicFiles.add.localFile.fsPath + '"'
                );
            });
            it("Cannot move shelved files", async () => {
                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );
                const resource2 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit
                );

                await expect(
                    PerforceSCMProvider.ReopenFile(resource1 as Resource, resource2)
                ).to.eventually.be.rejectedWith("Cannot reopen shelved file");

                expect(items.showImportantError).to.be.calledWith(
                    "Cannot reopen a shelved file"
                );
            });
            it("Handles an error when creating a changelist", async () => {
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[1]);
                });
                sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves("My selective changelist");
                items.stubService.setResponse("change", returnStdErr("My change error"));

                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource);
                expect(items.showImportantError).to.have.been.calledWith(
                    "My change error"
                );
                expect(items.execute).not.to.have.been.calledWithMatch(
                    sinon.match.any,
                    "reopen"
                );
            });
        });
        describe("Fix a Job", () => {
            it("Fixes a perforce job", async () => {
                sinon.stub(vscode.window, "showInputBox").resolves("job00001");
                await PerforceSCMProvider.FixJob(items.instance.resources[1]);

                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "fix",
                    sinon.match.any,
                    "-c 1 job00001"
                );

                expect(items.showMessage).to.have.been.calledWithMatch(
                    "Job job00001 added"
                );
            });
            it("Cannot fix with the default changelist", async () => {
                await expect(
                    PerforceSCMProvider.FixJob(items.instance.resources[0])
                ).to.eventually.be.rejectedWith(
                    "The default changelist cannot fix a job"
                );
            });
            it("Can be cancelled by not entering a job", async () => {
                sinon.stub(vscode.window, "showInputBox").resolves(undefined);
                await PerforceSCMProvider.FixJob(items.instance.resources[1]);

                expect(items.execute).not.to.have.been.calledWith(sinon.match.any, "fix");
            });
            it("Can handle an error fixing a perforce job", async () => {
                sinon.stub(vscode.window, "showInputBox").resolves("job00001");
                items.stubService.setResponse("fix", returnStdErr("My fix error"));

                await PerforceSCMProvider.FixJob(items.instance.resources[1]);

                expect(items.showImportantError).to.have.been.calledWith("My fix error");
            });
        });
        describe("Unfix a Job", () => {
            it("Displays a list of fixed jobs to unfix", async () => {
                items.stubService.changelists[0].jobs = [
                    { name: "job00001", description: ["a job"] },
                    {
                        name: "job00002",
                        description: ["a second job", "with multiple lines", "to show"]
                    }
                ];

                const quickPick = sinon
                    .stub(vscode.window, "showQuickPick")
                    .resolves(undefined);

                await PerforceSCMProvider.UnfixJob(items.instance.resources[1]);

                const itemArg = quickPick.lastCall.args[0] as vscode.QuickPickItem[];
                expect(itemArg).to.have.lengthOf(2);
                expect(itemArg[0]).to.include({
                    label: "job00001",
                    description: "a job"
                });
                expect(itemArg[1]).to.include({
                    label: "job00002",
                    description: "a second job",
                    detail: "with multiple lines to show"
                });

                expect(items.execute).not.to.have.been.calledWith(sinon.match.any, "fix");
            });
            it("Unfixes a perforce job", async () => {
                items.stubService.changelists[0].jobs = [
                    { name: "job00001", description: ["a job"] }
                ];
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });
                await PerforceSCMProvider.UnfixJob(items.instance.resources[1]);

                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "fix",
                    sinon.match.any,
                    "-c 1 -d job00001"
                );
                expect(items.showMessage).to.have.been.calledWithMatch(
                    "Job job00001 removed"
                );
            });
            it("Displays a message when there are no jobs to unfix", async () => {
                await PerforceSCMProvider.UnfixJob(items.instance.resources[2]);
                expect(items.showModalMessage).to.have.been.calledWith(
                    "Changelist 2 does not have any jobs attached"
                );
            });
            it("Cannot unfix with the default changelist", async () => {
                await expect(
                    PerforceSCMProvider.UnfixJob(items.instance.resources[0])
                ).to.eventually.be.rejectedWith(
                    "The default changelist cannot fix a job"
                );
            });
            it("Can handle an error unfixing a perforce job", async () => {
                items.stubService.changelists[0].jobs = [
                    { name: "job00001", description: ["a job"] }
                ];
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });
                items.stubService.setResponse("fix", returnStdErr("My fix error"));

                await PerforceSCMProvider.UnfixJob(items.instance.resources[1]);

                expect(items.showImportantError).to.have.been.calledWith("My fix error");
            });
        });
        describe("Revert file", () => {
            it("Prompts the user for confirmation", async () => {
                const prompt = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolves(undefined);

                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );

                await PerforceSCMProvider.Revert(resource as Resource);

                expect(prompt).to.be.calledOnce;
                expect(items.execute).not.to.have.been.calledWithMatch(
                    sinon.match.any,
                    "revert"
                );
            });
            it("Reverts an open file", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );

                await PerforceSCMProvider.Revert(resource as Resource);

                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    '"' + basicFiles.edit.localFile.fsPath + '"'
                );
            });
            it("Can revert multiple files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add
                );

                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.delete
                );

                await PerforceSCMProvider.Revert(resource1 as Resource, resource2);

                expect(warn).to.have.been.calledTwice;

                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    '"' + basicFiles.add.localFile.fsPath + '"'
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    '"' + basicFiles.delete.localFile.fsPath + '"'
                );
            });
            it("Cannot revert a shelved file", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.moveAdd
                );

                const resource2 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit
                );

                await PerforceSCMProvider.Revert(resource1 as Resource, resource2);

                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    '"' + basicFiles.moveAdd.localFile.fsPath + '"'
                );

                expect(items.execute).not.to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    "a.txt"
                );

                expect(items.showImportantError).to.have.been.calledWith(
                    "Revert cannot be used on shelved file: a.txt"
                );
            });
            it("Can revert if unchanged", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit
                );

                await PerforceSCMProvider.RevertUnchanged(resource as Resource);

                expect(warn).not.to.have.been.called;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    '-a  "' + basicFiles.edit.localFile.fsPath + '"'
                );
            });
        });
        describe("Revert changelist", () => {
            it("Prompts the user for confirmation", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolves(undefined);

                await PerforceSCMProvider.Revert(items.instance.resources[1]);

                expect(warn).to.have.been.calledOnce;
                expect(items.execute).not.to.have.been.calledWithMatch(
                    sinon.match.any,
                    "revert"
                );
            });
            it("Reverts a changelist and deletes it", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.Revert(items.instance.resources[2]);

                expect(warn).to.have.been.calledOnce;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    "-c 2"
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "change",
                    sinon.match.any,
                    "-d 2"
                );
            });
            it("Can revert the default changelist and does not attempt to delete it", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.Revert(items.instance.resources[0]);

                expect(warn).to.have.been.calledOnce;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    "-c default"
                );

                expect(items.execute).not.to.have.been.calledWithMatch(
                    sinon.match.any,
                    "change",
                    sinon.match.any,
                    "-d"
                );
            });
            it("Does not try to delete a changelist with shelved files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.Revert(items.instance.resources[1]);

                expect(warn).to.have.been.calledOnce;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    "-c 1"
                );
                expect(items.execute).not.to.have.been.calledWithMatch(
                    sinon.match.any,
                    "change",
                    sinon.match.any,
                    "-d"
                );
            });
            it("Can revert if unchanged", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.RevertUnchanged(items.instance.resources[2]);

                expect(warn).not.to.have.been.called;
                expect(items.execute).to.have.been.calledWithMatch(
                    workspaceUri,
                    "revert",
                    sinon.match.any,
                    "-a -c 2 //..."
                );
                expect(items.execute).to.have.been.calledWithMatch(
                    sinon.match.any,
                    "change",
                    sinon.match.any,
                    "-d 2"
                );
            });
            it("Can handle an error reverting a changelist", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                items.stubService.setResponse("revert", returnStdErr("My revert error"));

                await PerforceSCMProvider.RevertUnchanged(items.instance.resources[2]);

                expect(items.showError).to.have.been.calledWith("My revert error");
                // it still tries to revert, even with an error - because the changelist may already be empty
                expect(items.execute).to.have.been.calledWithMatch(
                    sinon.match.any,
                    "change",
                    sinon.match.any,
                    "-d 2"
                );
            });
        });
    });
});
