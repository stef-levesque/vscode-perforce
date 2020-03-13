import { expect } from "chai";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

import * as vscode from "vscode";

import sinon from "sinon";
import { IPerforceConfig } from "../../PerforceService";
import { PerforceSCMProvider } from "../../ScmProvider";
import { PerforceContentProvider } from "../../ContentProvider";
import { Display, ActiveStatusEvent, ActiveEditorStatus } from "../../Display";
import { Utils } from "../../Utils";
import { Resource } from "../../scm/Resource";
import { Status } from "../../scm/Status";
import p4Commands from "../helpers/p4Commands";
import { WorkspaceConfigAccessor } from "../../ConfigService";
import { StubPerforceModel, stubExecute, StubFile } from "../helpers/StubPerforceModel";

import {
    getLocalFile,
    perforceLocalUriMatcher,
    perforceDepotUriMatcher,
    perforceShelvedUriMatcher,
    perforceFromFileUriMatcher,
    perforceLocalShelvedUriMatcher
} from "../helpers/testUtils";
import { ChangeSpec } from "../../api/CommonTypes";
import { SubmitChangelistOptions } from "../../api/PerforceApi";

chai.use(sinonChai);
chai.use(p4Commands);
chai.use(chaiAsPromised);

interface TestItems {
    stubModel: StubPerforceModel;
    instance: PerforceSCMProvider;
    workspaceConfig: WorkspaceConfigAccessor;
    execute: sinon.SinonSpy;
    showMessage: sinon.SinonSpy<[string], void>;
    showModalMessage: sinon.SinonSpy<[string], void>;
    showError: sinon.SinonSpy<[string], void>;
    showImportantError: sinon.SinonSpy<[string], void>;
    refresh: sinon.SinonSpy;
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

/*function anotherFrame() {
    return new Promise(res => {
        setTimeout(() => res(), 1);
    });
}*/
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

const defaultRawFields = [{ name: "A field", value: ["don't know"] }];

describe("Model & ScmProvider modules (integration)", () => {
    if (!vscode.workspace.workspaceFolders?.[0]) {
        throw new Error("No workspace folders open");
    }
    const workspaceUri = vscode.workspace.workspaceFolders[0].uri;

    // these are functions, so that a new version StubFile is returned every time
    // mainly because uri.toString() mutates the Uri object and makes it harder to match
    const basicFiles: { [key: string]: () => StubFile } = {
        edit: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "a.txt"),
                depotPath: "//depot/testArea/testFolder/a.txt",
                depotRevision: 4,
                operation: Status.EDIT
            };
        },
        delete: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "deleted.txt"),
                depotPath: "//depot/testArea/testFolder/deleted.txt",
                depotRevision: 2,
                operation: Status.DELETE
            };
        },
        add: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "new.txt"),
                depotPath: "//depot/testArea/testFolder/new.txt",
                depotRevision: 3,
                operation: Status.ADD
            };
        },
        moveAdd: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "moved.txt"),
                depotPath: "//depot/testArea/testFolder/moved.txt",
                depotRevision: 1,
                operation: Status.MOVE_ADD,
                resolveFromDepotPath: "//depot/testArea/testFolderOld/movedFrom.txt",
                resolveEndFromRev: 4
            };
        },
        moveDelete: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolderOld", "movedFrom.txt"),
                depotPath: "//depot/testArea/testFolderOld/movedFrom.txt",
                depotRevision: 3,
                operation: Status.MOVE_DELETE
            };
        },
        branch: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "branched.txt"),
                depotPath: "//depot/testArea/testFolder/branched.txt",
                depotRevision: 1,
                operation: Status.BRANCH,
                resolveFromDepotPath: "//depot/testAreaOld/testFolder/branchedFrom.txt",
                resolveEndFromRev: 1
            };
        },
        integrate: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "integrated.txt"),
                depotPath: "//depot/testArea/testFolder/integrated.txt",
                depotRevision: 7,
                operation: Status.INTEGRATE,
                resolveFromDepotPath: "//depot/testAreaOld/testFolder/integrated.txt",
                resolveEndFromRev: 5
            };
        },
        outOfWorkspaceAdd: () => {
            return {
                localFile: getLocalFile(workspaceUri, "..", "outOfWorkspaceAdd.txt"),
                depotPath: "//depot/outOfWorkspaceAdd.txt",
                depotRevision: 1,
                operation: Status.ADD
            };
        },
        outOfWorkspaceEdit: () => {
            return {
                localFile: getLocalFile(workspaceUri, "..", "outOfWorkspace.txt"),
                depotPath: "//depot/outOfWorkspace.txt",
                depotRevision: 99,
                operation: Status.EDIT
            };
        },
        shelveNoWorkspace: () => {
            return {
                depotPath: "//depot/testArea/testFolder/none.txt",
                localFile: getLocalFile(workspaceUri, "testFolder", "none.txt"),
                suppressFstatClientFile: true,
                depotRevision: 1,
                operation: Status.ADD
            };
        },
        shelveEdit: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "a.txt"),
                depotPath: "//depot/testArea/testFolder/a.txt",
                depotRevision: 1,
                operation: Status.EDIT
            };
        },
        shelveDelete: () => {
            return {
                localFile: getLocalFile(workspaceUri, "testFolder", "deleted.txt"),
                depotPath: "//depot/testArea/testFolder/deleted.txt",
                depotRevision: 2,
                operation: Status.DELETE
            };
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
    const outerSubs: vscode.Disposable[] = [];

    before(async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        const doc = new PerforceContentProvider();
        outerSubs.push(doc);
        Display.initialize(outerSubs);
    });
    after(() => {
        outerSubs.forEach(d => d.dispose());
    });
    describe("Refresh / Initialize", function() {
        let stubModel: StubPerforceModel;
        let instance: PerforceSCMProvider;
        let workspaceConfig: WorkspaceConfigAccessor;
        let emitter: vscode.EventEmitter<ActiveStatusEvent>;

        this.beforeEach(function() {
            this.timeout(4000);

            emitter = new vscode.EventEmitter<ActiveStatusEvent>();
            sinon.replace(Display, "onActiveFileStatusKnown", emitter.event);

            // ensure p4 functions don't get called
            stubExecute();

            stubModel = new StubPerforceModel();

            workspaceConfig = new WorkspaceConfigAccessor(workspaceUri);

            // save time on refresh function calls
            sinon.stub(workspaceConfig, "refreshDebounceTime").get(() => 100);

            instance = new PerforceSCMProvider(config, workspaceUri, workspaceConfig);
            subscriptions.push(instance);
        });
        this.afterEach(async () => {
            subscriptions.forEach(sub => sub.dispose());
            emitter.dispose();
            sinon.restore();
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        });
        it("Handles no changelists", async () => {
            stubModel.changelists = [];

            await instance.Initialize();
            expect(instance.resources).to.have.lengthOf(1);
            expect(instance.resources[0].resourceStates).to.be.resources([]);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
        });
        it("Handles changelists with no open files", async () => {
            stubModel.changelists = [
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
            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch(), basicFiles.outOfWorkspaceEdit()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [
                        basicFiles.edit(),
                        basicFiles.delete(),
                        basicFiles.add(),
                        basicFiles.outOfWorkspaceAdd()
                    ]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd(), basicFiles.moveDelete()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.branch(),
                basicFiles.outOfWorkspaceEdit()
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.edit(),
                basicFiles.delete(),
                basicFiles.add(),
                basicFiles.outOfWorkspaceAdd()
            ]);
            expect(instance.resources[2].id).to.equal("pending:2");
            expect(instance.resources[2].label).to.equal("#2: changelist 2");
            expect(instance.resources[2].resourceStates).to.be.resources([
                basicFiles.moveAdd(),
                basicFiles.moveDelete()
            ]);
        });
        it("Handles shelved files with no open files", async () => {
            stubModel.changelists = [
                {
                    chnum: "3",
                    description: "shelved changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit()]
                },
                {
                    chnum: "4",
                    description: "shelved changelist 2",
                    files: [],
                    shelvedFiles: [basicFiles.shelveDelete()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:3");
            expect(instance.resources[1].label).to.equal("#3: shelved changelist 1");
            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit()
            ]);

            expect(instance.resources[2].id).to.equal("pending:4");
            expect(instance.resources[2].label).to.equal("#4: shelved changelist 2");
            expect(instance.resources[2].resourceStates).to.be.shelvedResources([
                basicFiles.shelveDelete()
            ]);
        });
        it("Handles open and shelved files", async () => {
            stubModel.changelists = [
                {
                    chnum: "5",
                    description: "mixed changelist 1",
                    files: [basicFiles.edit(), basicFiles.add()],
                    shelvedFiles: [basicFiles.shelveEdit()]
                },
                {
                    chnum: "6",
                    description: "mixed changelist 2",
                    files: [basicFiles.delete()],
                    shelvedFiles: [basicFiles.shelveDelete()]
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
            ).to.be.shelvedResources([basicFiles.shelveEdit()]);
            expect(instance.resources[1].resourceStates.slice(1)).to.be.resources([
                basicFiles.edit(),
                basicFiles.add()
            ]);

            expect(instance.resources[2].id).to.equal("pending:6");
            expect(instance.resources[2].label).to.equal("#6: mixed changelist 2");
            expect(
                instance.resources[2].resourceStates.slice(0, 1)
            ).to.be.shelvedResources([basicFiles.shelveDelete()]);
            expect(instance.resources[2].resourceStates.slice(1)).to.be.resources([
                basicFiles.delete()
            ]);
        });
        it("Includes new files open for shelve and not in the workspace", async () => {
            stubModel.changelists = [
                {
                    chnum: "7",
                    description: "changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveNoWorkspace()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:7");
            expect(instance.resources[1].label).to.equal("#7: changelist 1");

            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveNoWorkspace()
            ]);
        });
        it("Handles the same file shelved in two changelists", async () => {
            stubModel.changelists = [
                {
                    chnum: "8",
                    description: "changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit()]
                },
                {
                    chnum: "9",
                    description: "changelist 2",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:8");
            expect(instance.resources[1].label).to.equal("#8: changelist 1");

            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit()
            ]);

            expect(instance.resources[2].id).to.equal("pending:9");
            expect(instance.resources[2].label).to.equal("#9: changelist 2");

            expect(instance.resources[2].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit()
            ]);
        });
        it("Can sort changelists ascending", async () => {
            sinon.stub(workspaceConfig, "changelistOrder").get(() => "ascending");
            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit(), basicFiles.delete(), basicFiles.add()]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd(), basicFiles.moveDelete()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.branch()
            ]);
            expect(instance.resources[1].id).to.equal("pending:2");
            expect(instance.resources[1].label).to.equal("#2: changelist 2");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.moveAdd(),
                basicFiles.moveDelete()
            ]);
            expect(instance.resources[2].id).to.equal("pending:1");
            expect(instance.resources[2].label).to.equal("#1: changelist 1");
            expect(instance.resources[2].resourceStates).to.be.resources([
                basicFiles.edit(),
                basicFiles.delete(),
                basicFiles.add()
            ]);
        });
        it("Handles shelved files with no open files", async () => {
            stubModel.changelists = [
                {
                    chnum: "3",
                    description: "shelved changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveEdit()]
                },
                {
                    chnum: "4",
                    description: "shelved changelist 2",
                    files: [],
                    shelvedFiles: [basicFiles.shelveDelete()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:3");
            expect(instance.resources[1].label).to.equal("#3: shelved changelist 1");
            expect(instance.resources[1].resourceStates).to.be.shelvedResources([
                basicFiles.shelveEdit()
            ]);

            expect(instance.resources[2].id).to.equal("pending:4");
            expect(instance.resources[2].label).to.equal("#4: shelved changelist 2");
            expect(instance.resources[2].resourceStates).to.be.shelvedResources([
                basicFiles.shelveDelete()
            ]);
        });
        it("Has decorations for files", async () => {
            stubModel.changelists = [
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit(), basicFiles.delete()],
                    shelvedFiles: [basicFiles.shelveEdit(), basicFiles.shelveDelete()]
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

            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit(), basicFiles.delete(), basicFiles.add()],
                    shelvedFiles: [basicFiles.shelveDelete(), basicFiles.shelveEdit()]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd(), basicFiles.moveDelete()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(3);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.branch()
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(
                instance.resources[1].resourceStates.slice(0, 2)
            ).to.be.shelvedResources([
                basicFiles.shelveDelete(),
                basicFiles.shelveEdit()
            ]);
            expect(instance.resources[1].resourceStates.slice(2)).to.be.resources([
                basicFiles.edit(),
                basicFiles.delete(),
                basicFiles.add()
            ]);
            expect(instance.resources[2].id).to.equal("pending:2");
            expect(instance.resources[2].label).to.equal("#2: changelist 2");
            expect(instance.resources[2].resourceStates).to.be.resources([
                basicFiles.moveAdd(),
                basicFiles.moveDelete()
            ]);
        });
        it("Can be refreshed", async () => {
            stubModel.changelists = [];
            await instance.Initialize();
            expect(instance.resources).to.have.lengthOf(1);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.edit()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.add()]
                }
            ];

            await PerforceSCMProvider.RefreshAll();
            expect(instance.resources).to.have.lengthOf(2);
            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].label).to.equal("Default Changelist");
            expect(instance.resources[0].resourceStates).to.be.resources([
                basicFiles.edit()
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.add()
            ]);
        });
        it("Can be refreshed multiple times without duplication", async () => {
            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.edit()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.add()]
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
                basicFiles.edit()
            ]);
            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.add()
            ]);
        });
        it("Can ignore shelved files", async () => {
            sinon.stub(workspaceConfig, "hideShelvedFiles").get(() => true);

            stubModel.changelists = [
                {
                    chnum: "1",
                    description: "mixed changelist 1",
                    files: [basicFiles.add()],
                    shelvedFiles: [basicFiles.shelveEdit()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(2);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:1");
            expect(instance.resources[1].label).to.equal("#1: mixed changelist 1");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.add()
            ]);
        });
        it("Can hide non-workspace files", async () => {
            sinon.stub(workspaceConfig, "hideNonWorkspaceFiles").get(() => true);

            stubModel.changelists = [
                {
                    chnum: "1",
                    description: "mixed changelist 1",
                    files: [
                        basicFiles.add(),
                        basicFiles.outOfWorkspaceAdd(),
                        basicFiles.outOfWorkspaceEdit()
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
                basicFiles.add()
            ]);
        });
        it("Can ignore changelists with a defined prefix", async () => {
            sinon.stub(workspaceConfig, "ignoredChangelistPrefix").get(() => "ignore:");

            stubModel.changelists = [
                {
                    chnum: "1",
                    description: "ignore:me",
                    files: [basicFiles.add()]
                },
                {
                    chnum: "2",
                    description: "noignore:me",
                    files: [basicFiles.edit()]
                }
            ];

            await instance.Initialize();

            expect(instance.resources).to.have.lengthOf(2);

            expect(instance.resources[0].id).to.equal("default");
            expect(instance.resources[0].resourceStates).to.be.resources([]);

            expect(instance.resources[1].id).to.equal("pending:2");
            expect(instance.resources[1].label).to.equal("#2: noignore:me");
            expect(instance.resources[1].resourceStates).to.be.resources([
                basicFiles.edit()
            ]);
        });
        it("Counts open files but not shelved files", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "all-but-shelved");
            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit(), basicFiles.delete(), basicFiles.add()],
                    shelvedFiles: [basicFiles.shelveDelete(), basicFiles.shelveEdit()]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd(), basicFiles.moveDelete()] // move add and move delete count as one operation
                }
            ];

            await instance.Initialize();

            expect(instance.count).to.equal(5);
        });
        it("Can count shelved files", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "all");
            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit(), basicFiles.delete(), basicFiles.add()],
                    shelvedFiles: [basicFiles.shelveDelete(), basicFiles.shelveEdit()]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd(), basicFiles.moveDelete()] // move add and move delete count as one operation
                }
            ];

            await instance.Initialize();

            expect(instance.count).to.equal(7);
        });
        it("Can disable counting files", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "off");
            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [],
                    shelvedFiles: [basicFiles.shelveDelete()]
                }
            ];

            await instance.Initialize();

            expect(instance.count).to.equal(0);
        });
        it("Updates the count after refresh", async () => {
            sinon.stub(workspaceConfig, "countBadge").get(() => "all-but-shelved");

            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit(), basicFiles.delete(), basicFiles.add()]
                }
            ];

            await instance.Initialize();
            expect(instance.count).to.equal(4);

            stubModel.changelists = [
                {
                    chnum: "default",
                    description: "n/a",
                    files: [basicFiles.branch(), basicFiles.integrate()]
                },
                {
                    chnum: "1",
                    description: "changelist 1",
                    files: [basicFiles.edit(), basicFiles.delete(), basicFiles.add()]
                },
                {
                    chnum: "2",
                    description: "changelist 2",
                    files: [basicFiles.moveAdd(), basicFiles.moveDelete()]
                }
            ];
            await PerforceSCMProvider.RefreshAll();
            expect(instance.count).to.equal(6);
        });
        describe("State conflicts", () => {
            it("Marks open files as conflicting when the display indicates they are not open", async () => {
                stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit()]
                    }
                ];
                await instance.Initialize();
                const uri = basicFiles.edit().localFile;

                emitter.fire({ file: uri, status: ActiveEditorStatus.NOT_OPEN });
                expect(PerforceSCMProvider.mayHaveConflictForFile(uri)).to.be.true;
            });
            it("Does not mark files as conflicting if states match", async () => {
                stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit()]
                    }
                ];
                await instance.Initialize();
                const uri = basicFiles.edit().localFile;

                emitter.fire({ file: uri, status: ActiveEditorStatus.OPEN });
                expect(PerforceSCMProvider.mayHaveConflictForFile(uri)).to.be.false;
            });
            it("Considers everything open as potentially conflicting during a refresh", async () => {
                stubModel.changelists = [
                    {
                        chnum: "1",
                        description: "change 1",
                        files: [basicFiles.edit()]
                    }
                ];
                await instance.Initialize();

                const uri = basicFiles.edit().localFile;

                const prom = PerforceSCMProvider.RefreshAll();
                expect(PerforceSCMProvider.mayHaveConflictForFile(uri)).to.be.true;
                expect(
                    PerforceSCMProvider.mayHaveConflictForFile(basicFiles.add().localFile)
                ).to.be.false;
                await prom;
                expect(PerforceSCMProvider.mayHaveConflictForFile(uri)).to.be.false;
            });
            it("Ignores shelved files", async () => {
                stubModel.changelists = [
                    {
                        chnum: "1",
                        description: "change 1",
                        files: [],
                        shelvedFiles: [basicFiles.shelveEdit()]
                    }
                ];
                await instance.Initialize();

                const uri = basicFiles.shelveEdit().localFile;

                emitter.fire({ file: uri, status: ActiveEditorStatus.OPEN });
                expect(PerforceSCMProvider.mayHaveConflictForFile(uri)).to.be.false;
            });
            it("Ignores files where the active status is not NOT_OPEN", async () => {
                stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit()]
                    }
                ];
                await instance.Initialize();
                const uri = basicFiles.edit().localFile;
                const notOpenUri = basicFiles.add().localFile;

                emitter.fire({ file: uri, status: ActiveEditorStatus.OPEN });
                expect(PerforceSCMProvider.mayHaveConflictForFile(uri)).to.be.false;

                emitter.fire({ file: uri, status: ActiveEditorStatus.NOT_IN_WORKSPACE });
                expect(PerforceSCMProvider.mayHaveConflictForFile(uri)).to.be.false;

                emitter.fire({ file: notOpenUri, status: ActiveEditorStatus.OPEN });
                expect(PerforceSCMProvider.mayHaveConflictForFile(notOpenUri)).to.be
                    .false;

                emitter.fire({
                    file: notOpenUri,
                    status: ActiveEditorStatus.NOT_IN_WORKSPACE
                });
                expect(PerforceSCMProvider.mayHaveConflictForFile(notOpenUri)).to.be
                    .false;
            });
        });
    });
    describe("Actions", function() {
        let skipInitialise = false;
        beforeEach(async function() {
            this.timeout(4000);
            const showMessage = sinon.spy(Display, "showMessage");
            const showError = sinon.spy(Display, "showError");

            const stubModel = new StubPerforceModel();
            stubModel.changelists = [
                {
                    chnum: "1",
                    description: "Changelist 1",
                    files: [
                        basicFiles.edit(),
                        basicFiles.delete(),
                        basicFiles.add(),
                        basicFiles.moveAdd(),
                        basicFiles.moveDelete(),
                        basicFiles.branch(),
                        basicFiles.integrate()
                    ],
                    shelvedFiles: [basicFiles.shelveEdit(), basicFiles.shelveDelete()]
                },
                {
                    chnum: "2",
                    description: "Changelist 2",
                    files: []
                },
                {
                    chnum: "3",
                    description: "Changelist 3",
                    submitted: true,
                    files: []
                }
            ];
            const execute = stubExecute();
            const workspaceConfig = new WorkspaceConfigAccessor(workspaceUri);
            sinon.stub(workspaceConfig, "refreshDebounceTime").get(() => 0);

            const instance = new PerforceSCMProvider(
                config,
                workspaceUri,
                workspaceConfig
            );
            subscriptions.push(instance);

            if (!skipInitialise) {
                await instance.Initialize();
            }

            const showImportantError = sinon.spy(Display, "showImportantError");
            const showModalMessage = sinon.stub(Display, "showModalMessage"); // stub because modal gets in the way

            // Need to stub this private function - it kicks off some async calls that are not
            // awaited, so can interfere with later tests and produce undesirable log output.
            const refresh = sinon.fake();
            sinon.stub((instance as any)._model, "Refresh").callsFake(refresh);
            sinon.stub((instance as any)._model, "RefreshPolitely").callsFake(refresh);

            items = {
                stubModel,
                instance,
                workspaceConfig,
                execute,
                showMessage,
                showModalMessage,
                showError,
                showImportantError,
                refresh
            };

            //subscriptions.push(instance.onRefreshStarted(refresh));
        });
        afterEach(async () => {
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            subscriptions.forEach(sub => sub.dispose());
            subscriptions = [];
            sinon.restore();
        });

        describe("Provide original resource", () => {
            it("Diffs against the have revision", async () => {
                const out = await items.instance.provideOriginalResource(
                    basicFiles.add().localFile
                );

                expect(out).to.deep.equal(
                    basicFiles.add().localFile.with({
                        scheme: "perforce",
                        fragment: "have",
                        query: "p4args=-q&command=print"
                    })
                );
            });
            it("Does not diff non-file resources", async () => {
                const inUri = Utils.makePerforceDocUri(
                    basicFiles.edit().localFile,
                    "print"
                );
                const out = await items.instance.provideOriginalResource(inUri);
                expect(out).to.be.undefined;
            });
            it("Diffs moved files against the original file", async () => {
                const out = await items.instance.provideOriginalResource(
                    basicFiles.moveAdd().localFile
                );

                expect(out).to.deep.equal(
                    vscode.Uri.parse(basicFiles.moveDelete().depotPath).with({
                        scheme: "perforce",
                        fragment: "4",
                        query: "p4args=-q&command=print&depot"
                    })
                );
            });
        });
        describe("Shelving a changelist", () => {
            it("Cannot shelve the default changelist", async () => {
                await expect(
                    PerforceSCMProvider.ShelveChangelist(items.instance.resources[0])
                ).to.eventually.be.rejectedWith("Cannot shelve the default changelist");
                expect(items.stubModel.shelve).not.to.have.been.called;
                expect(items.refresh).not.to.have.been.called;
            });

            it("Can shelve a valid Changelist", async () => {
                await PerforceSCMProvider.ShelveChangelist(items.instance.resources[1]);
                expect(items.stubModel.shelve).to.have.been.been.calledOnceWith(
                    workspaceUri,
                    {
                        chnum: "1",
                        force: true
                    }
                );
                expect(items.showMessage).to.have.been.calledOnceWith(
                    "Changelist shelved"
                );
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Can shelve and revert a valid changelist", async () => {
                await PerforceSCMProvider.ShelveRevertChangelist(
                    items.instance.resources[1]
                );
                expect(items.stubModel.shelve).to.have.been.been.calledOnceWith(
                    workspaceUri,
                    {
                        chnum: "1",
                        force: true
                    }
                );
                expect(items.stubModel.revert).to.have.been.been.calledOnceWith(
                    workspaceUri,
                    {
                        chnum: "1",
                        paths: ["//..."]
                    }
                );
                expect(items.showMessage).to.have.been.calledOnceWith(
                    "Changelist shelved"
                );
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Can handle an error when shelving a changelist", async () => {
                items.stubModel.shelve
                    .withArgs(sinon.match.any, sinon.match({ chnum: "2" }))
                    .rejects("my shelve error");
                await PerforceSCMProvider.ShelveChangelist(items.instance.resources[2]);
                expect(items.showMessage).not.to.have.been.called;
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my shelve error"
                );
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Can handle an error when shelving and reverting a changelist", async () => {
                items.stubModel.shelve
                    .withArgs(sinon.match.any, sinon.match({ chnum: "2" }))
                    .rejects("my shelve error");
                await PerforceSCMProvider.ShelveRevertChangelist(
                    items.instance.resources[2]
                );
                expect(items.showMessage).not.to.have.been.called;
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my shelve error"
                );
                expect(items.refresh).to.have.been.calledOnce;
            });
        });

        describe("Unshelving a changelist", () => {
            it("Can unshelve a valid Changelist", async () => {
                await PerforceSCMProvider.UnshelveChangelist(items.instance.resources[1]);
                expect(items.stubModel.unshelve).to.have.been.calledWith(workspaceUri, {
                    force: true,
                    shelvedChnum: "1",
                    toChnum: "1"
                });
                expect(items.showMessage).to.have.been.calledOnceWith(
                    "Changelist unshelved"
                );
                expect(items.refresh).to.have.been.calledOnce;
            });

            it("Cannot unshelve default changelist", async () => {
                await expect(
                    PerforceSCMProvider.UnshelveChangelist(items.instance.resources[0])
                ).to.eventually.be.rejectedWith("Cannot unshelve the default changelist");
                expect(items.stubModel.unshelve).not.to.have.been.called;
                expect(items.refresh).not.to.have.been.called;
            });

            it("Can handle an error when unshelving a changelist", async () => {
                items.stubModel.unshelve
                    .withArgs(sinon.match.any, sinon.match({ toChnum: "2" }))
                    .rejects("my unshelve error");
                await PerforceSCMProvider.UnshelveChangelist(items.instance.resources[2]);

                expect(items.showMessage).not.to.have.been.called;
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my unshelve error"
                );
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

                expect(items.stubModel.shelve).to.have.been.calledWithMatch(
                    workspaceUri,
                    { chnum: "1", delete: true }
                );
                expect(items.refresh).to.have.been.calledOnce;
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
                expect(items.refresh).not.to.have.been.called;
                expect(items.stubModel.shelve).not.to.have.been.called;
            });

            it("Can handle an error when deleting a shelved changelist", async () => {
                // accept the warning
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                items.stubModel.shelve
                    .withArgs(sinon.match.any, sinon.match({ chnum: "2" }))
                    .rejects("my shelve error");

                await PerforceSCMProvider.DeleteShelvedChangelist(
                    items.instance.resources[2]
                );

                expect(warn).to.have.been.calledOnce;
                expect(items.showImportantError).to.have.been.calledOnceWith(
                    "my shelve error"
                );
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
                expect(items.stubModel.shelve).not.to.have.been.called;
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
                    basicFiles.shelveDelete()
                );

                await PerforceSCMProvider.DeleteShelvedFile(resource as Resource);

                expect(prompt).to.be.calledOnce;
                expect(items.stubModel.shelve).not.to.have.been.called;
            });
            it("Deletes the shelved file", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                const resource = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete()
                );

                await PerforceSCMProvider.DeleteShelvedFile(resource as Resource);

                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    delete: true,
                    chnum: "1",
                    paths: [basicFiles.shelveDelete().depotPath]
                });
            });
            it("Can delete multiple shelved files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource1 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete()
                );
                const resource2 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit()
                );

                await PerforceSCMProvider.DeleteShelvedFile(
                    resource1 as Resource,
                    resource2
                );

                expect(warn).to.have.been.calledTwice;
                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    delete: true,
                    chnum: "1",
                    paths: [basicFiles.shelveDelete().depotPath]
                });
                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    delete: true,
                    chnum: "1",
                    paths: [basicFiles.shelveEdit().depotPath]
                });
            });
            it("Cannot be used on normal files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource1 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete()
                );
                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add()
                );

                await PerforceSCMProvider.DeleteShelvedFile(
                    resource1 as Resource,
                    resource2
                );

                expect(warn).to.have.been.calledOnce;
                expect(items.showImportantError).to.have.been.calledWith(
                    "Shelve cannot be used on normal file: new.txt"
                );
                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    delete: true,
                    chnum: "1",
                    paths: [basicFiles.shelveDelete().depotPath]
                });
                expect(items.stubModel.shelve).to.have.been.calledOnce;
            });
        });

        describe("Shelve / Unshelve a file", () => {
            it("Shelves an open file and presents an option to revert", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolves(undefined);

                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );

                await PerforceSCMProvider.ShelveOrUnshelve(resource);

                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    force: true,
                    paths: [{ fsPath: basicFiles.edit().localFile.fsPath }]
                });

                expect(warn).to.have.been.calledOnce;

                expect(items.stubModel.revert).not.to.have.been.called;
                expect(items.refresh).to.have.been.calledOnce;
            });
            it("Shelves and reverts an open file", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );

                await PerforceSCMProvider.ShelveOrUnshelve(resource);

                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    force: true,
                    paths: [{ fsPath: basicFiles.edit().localFile.fsPath }]
                });

                expect(warn).to.have.been.calledOnce;
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    paths: [{ fsPath: basicFiles.edit().localFile.fsPath }],
                    unchanged: undefined
                });
                expect(items.refresh).to.have.been.called;
            });
            it("Unshelves a shelved file and deletes the shelved file", async () => {
                const resource = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit()
                );

                await PerforceSCMProvider.ShelveOrUnshelve(resource);

                expect(items.stubModel.unshelve).to.have.been.calledWith(workspaceUri, {
                    toChnum: "1",
                    shelvedChnum: "1",
                    paths: [basicFiles.shelveEdit().depotPath]
                });
                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    delete: true,
                    paths: [basicFiles.shelveEdit().depotPath]
                });
                expect(items.refresh).to.have.been.called;
            });
            it("Does not delete the shelved file if the unshelve fails", async () => {
                const resource = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit()
                );

                items.stubModel.unshelve.rejects("badness");

                await PerforceSCMProvider.ShelveOrUnshelve(resource);

                expect(items.stubModel.unshelve).to.have.been.calledWith(workspaceUri, {
                    toChnum: "1",
                    shelvedChnum: "1",
                    paths: [basicFiles.shelveEdit().depotPath]
                });

                expect(items.stubModel.shelve).not.to.have.been.called;
                expect(items.showImportantError).to.have.been.calledWith("badness");
                expect(items.refresh).to.have.been.called;
            });
            it("Can shelve or unshelve multiple files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );

                const resource2 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveDelete()
                );

                await PerforceSCMProvider.ShelveOrUnshelve(resource1, resource2);

                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    force: true,
                    paths: [{ fsPath: basicFiles.edit().localFile.fsPath }]
                });

                expect(warn).to.have.been.calledOnce;
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    paths: [{ fsPath: basicFiles.edit().localFile.fsPath }],
                    unchanged: undefined
                });

                expect(items.stubModel.unshelve).to.have.been.calledWith(workspaceUri, {
                    toChnum: "1",
                    shelvedChnum: "1",
                    paths: [basicFiles.shelveDelete().depotPath]
                });
                expect(items.stubModel.shelve).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    delete: true,
                    paths: [basicFiles.shelveDelete().depotPath]
                });
                expect(items.refresh).to.have.been.called;
            });
        });

        describe("Opening", () => {
            let execCommand: sinon.SinonSpy<[string, ...any[]], Thenable<unknown>>;
            beforeEach(function() {
                this.timeout(4000);
                execCommand = sinon.spy(vscode.commands, "executeCommand");
            });

            describe("When opening a file", () => {
                it("Opens the underlying workspace file", async () => {
                    const file = basicFiles.edit();
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    expect(resource).not.to.be.undefined;
                    await PerforceSCMProvider.OpenFile(resource);

                    expect(execCommand.lastCall).to.be.vscodeOpenCall(file.localFile);
                });
                it("Can open multiple files", async () => {
                    const file1 = basicFiles.edit();
                    const resource1 = findResourceForFile(
                        items.instance.resources[1],
                        file1
                    );

                    const file2 = basicFiles.add();
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
                    const file = basicFiles.edit();
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceLocalUriMatcher(file),
                        file.localFile,
                        "a.txt#4 vs a.txt (workspace)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        file.localFile,
                        "print",
                        sinon.match.any,
                        ["-q", file.localFile.fsPath + "#4"]
                    );
                });
                it("Can open multiple resources", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");
                    const file1 = basicFiles.edit();
                    const resource1 = findResourceForFile(
                        items.instance.resources[1],
                        file1
                    );

                    const file2 = basicFiles.delete();
                    const resource2 = findResourceForFile(
                        items.instance.resources[1],
                        file2
                    );

                    await PerforceSCMProvider.Open(resource1, resource2);

                    expect(execCommand.getCall(-1)).to.be.vscodeDiffCall(
                        perforceLocalUriMatcher(file1),
                        file1.localFile,
                        "a.txt#4 vs a.txt"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        file1.localFile,
                        "print",
                        sinon.match.any,
                        ["-q", file1.localFile.fsPath + "#4"]
                    );
                    expect(td.lastCall.args[0]).to.be.p4Uri(
                        perforceLocalUriMatcher(file2)
                    );
                });
                it("Displays the depot version of a deleted file", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");

                    const file = basicFiles.delete();
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
                    const file = basicFiles.add();
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        vscode.Uri.parse("perforce:EMPTY"),
                        file.localFile,
                        "new.txt#0 vs new.txt (workspace)"
                    );
                });
                it("Diffs a moved file against the original file", async () => {
                    const file = basicFiles.moveAdd();
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceFromFileUriMatcher(file),
                        file.localFile,
                        "movedFrom.txt#4 vs moved.txt (workspace)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        sinon.match({ fsPath: workspaceUri.fsPath }),
                        "print",
                        sinon.match.any,
                        ["-q", file.resolveFromDepotPath + "#4"]
                    );
                });
                it("Displays the depot version for a move / delete", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");

                    const file = basicFiles.moveDelete();
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
                    const file = basicFiles.branch();
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        vscode.Uri.parse("perforce:EMPTY"),
                        file.localFile,
                        "branched.txt#0 vs branched.txt (workspace)"
                    );
                });
                it("Diffs an integration/merge against the target depot file", async () => {
                    const file = basicFiles.integrate();
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceLocalUriMatcher(file),
                        file.localFile,
                        "integrated.txt#7 vs integrated.txt (workspace)"
                    );

                    expect(items.execute).to.be.calledWithMatch(
                        file.localFile,
                        "print",
                        sinon.match.any,
                        ["-q", file.localFile.fsPath + "#7"]
                    );
                });
                it("Diffs a shelved file against the depot file", async () => {
                    const file = basicFiles.shelveEdit();
                    const resource = findResourceForShelvedFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.Open(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceDepotUriMatcher(file),
                        perforceShelvedUriMatcher(file, "1"),
                        "a.txt#1 vs a.txt@=1"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        { fsPath: workspaceUri.fsPath },
                        "print",
                        sinon.match.any,
                        ["-q", file.depotPath + "@=1"]
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        { fsPath: workspaceUri.fsPath },
                        "print",
                        sinon.match.any,
                        ["-q", file.depotPath + "#1"]
                    );
                });
                it("Can diff a local file against the shelved file (from the shelved file)", async () => {
                    const file = basicFiles.shelveEdit();
                    const resource = findResourceForShelvedFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.OpenvShelved(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceShelvedUriMatcher(file, "1"),
                        file.localFile,
                        "a.txt@=1 vs a.txt (workspace)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        { fsPath: workspaceUri.fsPath },
                        "print",
                        sinon.match.any,
                        ["-q", file.depotPath + "@=1"]
                    );
                });
                it("Can diff a local file against the shelved file (from the local file)", async () => {
                    const file = basicFiles.shelveEdit();
                    const resource = findResourceForFile(
                        items.instance.resources[1],
                        file
                    );

                    await PerforceSCMProvider.OpenvShelved(resource);

                    expect(execCommand.lastCall).to.be.vscodeDiffCall(
                        perforceLocalShelvedUriMatcher(file, "1"),
                        file.localFile,
                        "a.txt@=1 vs a.txt (workspace)"
                    );
                    expect(items.execute).to.be.calledWithMatch(
                        file.localFile,
                        "print",
                        sinon.match.any,
                        ["-q", file.localFile.fsPath + "@=1"]
                    );
                });
                it("Displays the depot version for a shelved deletion", async () => {
                    const td = sinon.stub(vscode.window, "showTextDocument");
                    const file = basicFiles.shelveDelete();
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
                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        files: [basicFiles.add(), basicFiles.edit()],
                        description: "n/a"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubModel.inputChangeSpec).to.have.been.calledWith(
                    workspaceUri,
                    {
                        spec: {
                            description: "My new changelist\nline 2\nline 3",
                            files: [
                                { depotPath: basicFiles.add().depotPath, action: "add" },
                                { depotPath: basicFiles.edit().depotPath, action: "edit" }
                            ],
                            rawFields: defaultRawFields
                        }
                    }
                );
            });
            it("Can save from an empty default changelist", async () => {
                items.instance.sourceControl.inputBox.value = "My new changelist";
                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        files: [],
                        description: "n/a"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubModel.inputChangeSpec).to.have.been.calledWith(
                    workspaceUri,
                    {
                        spec: {
                            description: "My new changelist",
                            files: [],
                            rawFields: defaultRawFields
                        }
                    }
                );
            });
            it("Can change the description of an existing changelist", async () => {
                items.instance.sourceControl.inputBox.value =
                    "#1\nMy updated changelist\nline2";
                items.stubModel.changelists = [
                    {
                        chnum: "1",
                        files: [basicFiles.add(), basicFiles.edit()],
                        description: "changelist 1"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubModel.inputChangeSpec).to.have.been.calledWith(
                    workspaceUri,
                    {
                        spec: {
                            change: "1",
                            description: "My updated changelist\nline2",
                            files: [
                                { action: "add", depotPath: basicFiles.add().depotPath },
                                { action: "edit", depotPath: basicFiles.edit().depotPath }
                            ],
                            rawFields: defaultRawFields
                        }
                    }
                );
            });
            it("Can change the description of an empty changelist", async () => {
                items.instance.sourceControl.inputBox.value = "#1\nMy updated changelist";
                items.stubModel.changelists = [
                    {
                        chnum: "1",
                        files: [],
                        description: "changelist 1"
                    }
                ];
                await PerforceSCMProvider.ProcessChangelist(items.instance.sourceControl);
                expect(items.stubModel.inputChangeSpec).to.have.been.calledWith(
                    workspaceUri,
                    {
                        spec: {
                            change: "1",
                            description: "My updated changelist",
                            files: [],
                            rawFields: defaultRawFields
                        }
                    }
                );
            });
            describe("Edit Changelist", () => {
                it("Uses the source control input box for entering the description", async () => {
                    items.stubModel.getChangeSpec.resolves({
                        description: "My description\nwith newline",
                        change: "1",
                        files: [],
                        rawFields: []
                    } as ChangeSpec);

                    await PerforceSCMProvider.EditChangelist(items.instance.resources[1]);

                    expect(items.instance.sourceControl.inputBox.value).to.equals(
                        "#1\nMy description\nwith newline"
                    );
                });
            });
        });
        describe("Submit default", () => {
            it("Does not submit an empty changelist", async () => {
                const showInputBox = sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves("my description");

                await PerforceSCMProvider.SubmitDefault(items.instance.sourceControl);

                expect(items.showError).to.have.been.calledWith(
                    "Error: The default changelist is empty"
                );

                expect(showInputBox).not.to.have.been.called;
                expect(items.stubModel.submitChangelist).not.to.have.been.called;
                expect(items.refresh).not.to.have.been.called;
            });
            it("Requests a description and asks whether to save / submit the changelist", async () => {
                const showInputBox = sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves("my description");

                const quickPick = sinon
                    .stub(vscode.window, "showQuickPick")
                    .resolves(undefined);

                items.stubModel.changelists = [
                    { chnum: "default", description: "n/a", files: [basicFiles.edit()] }
                ];

                await PerforceSCMProvider.SubmitDefault(items.instance.sourceControl);
                expect(showInputBox).to.have.been.called;

                const itemArg = quickPick.lastCall.args[0] as vscode.QuickPickItem[];
                expect(itemArg).to.deep.equal(["Submit", "Save Changelist", "Cancel"]);

                expect(items.stubModel.submitChangelist).not.to.have.been.called;
                expect(items.refresh).not.to.have.been.called;
            });
            it("Saves the changelist when the option is chosen", async () => {
                const showInputBox = sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves("my description");

                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[1]);
                });

                items.stubModel.changelists = [
                    { chnum: "default", description: "n/a", files: [basicFiles.edit()] }
                ];

                await PerforceSCMProvider.SubmitDefault(items.instance.sourceControl);
                expect(showInputBox).to.have.been.called;

                expect(items.stubModel.inputChangeSpec).to.have.been.called;
                expect(items.refresh).to.have.been.called;
            });
            it("Submits the default changelist when it has files", async () => {
                const showInputBox = sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves("my description");

                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });

                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit(), basicFiles.outOfWorkspaceAdd()]
                    }
                ];

                await PerforceSCMProvider.SubmitDefault(items.instance.sourceControl);
                expect(showInputBox).to.have.been.called;

                expect(items.stubModel.submitChangelist).to.have.been.calledWith(
                    workspaceUri,
                    {
                        description: "my description"
                    } as SubmitChangelistOptions
                );
                expect(items.refresh).to.have.been.called;
            });
            it("Excludes files not in the workspace when configured to hide them", async () => {
                sinon
                    .stub(items.workspaceConfig, "hideNonWorkspaceFiles")
                    .get(() => true);

                sinon.stub(vscode.window, "showInputBox").resolves("my description");

                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });

                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit(), basicFiles.outOfWorkspaceEdit()]
                    }
                ];

                await PerforceSCMProvider.SubmitDefault(items.instance.sourceControl);

                expect(items.stubModel.inputChangeSpec).to.have.been.calledWith(
                    workspaceUri
                );
                const call = items.stubModel.inputChangeSpec.lastCall;
                expect(call.args[1].spec).to.deep.include({
                    files: [{ action: "edit", depotPath: basicFiles.edit().depotPath }]
                });
                expect(call.args[1].spec.files).to.have.length(1);

                expect(items.stubModel.submitChangelist).to.have.been.calledWith(
                    workspaceUri,
                    {
                        chnum: "99"
                    } as SubmitChangelistOptions
                );

                expect(items.refresh).to.have.been.called;
            });
        });
        describe("Submit", () => {
            it("Cannot submit the default changelist", async () => {
                await expect(
                    PerforceSCMProvider.Submit(items.instance.resources[0])
                ).to.eventually.be.rejectedWith(
                    "The default changelist is not valid for this operation"
                );
            });
            it("Submits the selected changelist", async () => {
                await PerforceSCMProvider.Submit(items.instance.resources[1]);

                expect(items.stubModel.submitChangelist).to.have.been.calledWith(
                    workspaceUri,
                    {
                        chnum: "1"
                    }
                );
            });
            it("Prompts the user first when configured to do so", async () => {
                sinon.stub(items.workspaceConfig, "promptBeforeSubmit").get(() => true);
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolves(undefined);

                await PerforceSCMProvider.Submit(items.instance.resources[1]);

                expect(warn).to.have.been.calledWithMatch("changelist 1");

                expect(items.stubModel.submitChangelist).not.to.have.been.called;
            });
            it("Submits on confirmation", async () => {
                sinon.stub(items.workspaceConfig, "promptBeforeSubmit").get(() => true);
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.Submit(items.instance.resources[1]);

                expect(warn).to.have.been.calledWithMatch("changelist 1");

                expect(items.stubModel.submitChangelist).to.have.been.calledWith(
                    workspaceUri,
                    {
                        chnum: "1"
                    }
                );
            });
        });
        describe("Submit selected files", () => {
            before(() => {
                // need to override the files in the scm provider without having to refresh
                skipInitialise = true;
            });
            after(() => {
                skipInitialise = false;
            });
            it("Cannot submit files not in the default changelist", async () => {
                await items.instance.Initialize();
                sinon.resetHistory();

                const file = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );
                await PerforceSCMProvider.SubmitSelectedFiles(file);
                expect(items.showModalMessage).to.have.been.calledWithMatch(
                    "default changelist"
                );
                expect(items.stubModel.inputChangeSpec).not.to.have.been.called;
                expect(items.stubModel.submitChangelist).not.to.have.been.called;
            });
            it("Does not submit if the default changelist is inconsistent", async () => {
                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit(), basicFiles.add(), basicFiles.delete()]
                    }
                ];

                await items.instance.Initialize();
                sinon.resetHistory();

                const showInput = sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves(undefined);

                const resource = findResourceForFile(
                    items.instance.resources[0],
                    basicFiles.edit()
                );

                // pretend we've submitted outside of vs code
                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.add(), basicFiles.delete()]
                    }
                ];

                await PerforceSCMProvider.SubmitSelectedFiles(resource);

                expect(items.showModalMessage).to.have.been.calledWithMatch(
                    "inconsistent"
                );
                expect(showInput).not.to.have.been.called;
                expect(items.stubModel.inputChangeSpec).not.to.have.been.called;
                expect(items.stubModel.submitChangelist).not.to.have.been.called;
            });
            it("Prompts for a changelist description", async () => {
                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit(), basicFiles.add(), basicFiles.delete()]
                    }
                ];

                await items.instance.Initialize();
                sinon.resetHistory();

                const showInput = sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves(undefined);

                const resource = findResourceForFile(
                    items.instance.resources[0],
                    basicFiles.edit()
                );

                await PerforceSCMProvider.SubmitSelectedFiles(resource);

                expect(showInput).to.have.been.called;

                expect(items.stubModel.inputChangeSpec).not.to.have.been.called;
                expect(items.stubModel.submitChangelist).not.to.have.been.called;
            });
            it("Submits the changelist with the selected files and description", async () => {
                items.stubModel.changelists = [
                    {
                        chnum: "default",
                        description: "n/a",
                        files: [basicFiles.edit(), basicFiles.add(), basicFiles.delete()]
                    }
                ];

                await items.instance.Initialize();
                sinon.resetHistory();

                sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves("my changelist description");

                const resource1 = findResourceForFile(
                    items.instance.resources[0],
                    basicFiles.edit()
                );

                const resource2 = findResourceForFile(
                    items.instance.resources[0],
                    basicFiles.delete()
                );

                await PerforceSCMProvider.SubmitSelectedFiles(resource1, resource2);

                expect(items.stubModel.inputChangeSpec).to.have.been.called;
                expect(
                    items.stubModel.inputChangeSpec.lastCall.args[1].spec
                ).to.deep.include({
                    files: [
                        { action: "edit", depotPath: basicFiles.edit().depotPath },
                        { action: "delete", depotPath: basicFiles.delete().depotPath }
                    ],
                    description: "my changelist description"
                });
                expect(
                    items.stubModel.inputChangeSpec.lastCall.args[1].spec.files
                ).to.have.length(2);

                expect(items.stubModel.submitChangelist).to.have.been.calledWith(
                    workspaceUri,
                    {
                        chnum: "99" // stubbed value
                    }
                );

                expect(items.refresh).to.have.been.called;
            });
        });
        describe("Describe", () => {
            it("Can describe the default changelist");
            it("Can describe a pending changelist");
        });
        describe("Move files to a changelist", () => {
            it("Displays a selection of changelists to choose from", async () => {
                const quickPick = sinon
                    .stub(vscode.window, "showQuickPick")
                    .resolves(undefined);
                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
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

                expect(items.stubModel.reopenFiles).not.to.have.been.called;
            });
            it("Can move files to a changelist", async () => {
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[3]);
                });
                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );
                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add()
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource, resource2);

                expect(items.stubModel.reopenFiles).to.have.been.calledWith(
                    workspaceUri,
                    {
                        chnum: "2",
                        files: [
                            { fsPath: basicFiles.add().localFile.fsPath },
                            { fsPath: basicFiles.edit().localFile.fsPath }
                        ]
                    }
                );
            });
            it("Can move files to the default changelist", async () => {
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });
                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource);

                // TODO this shouldn't need to be many commands
                expect(items.stubModel.reopenFiles).to.have.been.calledWith(
                    workspaceUri,
                    {
                        chnum: "default",
                        files: [{ fsPath: basicFiles.edit().localFile.fsPath }]
                    }
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
                    basicFiles.edit()
                );
                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add()
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource, resource2);

                expect(items.stubModel.inputChangeSpec).to.have.been.calledWith(
                    workspaceUri,
                    {
                        spec: {
                            description: "My selective changelist\nLine 2\nLine 3",
                            files: [],
                            rawFields: defaultRawFields
                        }
                    }
                );

                expect(items.stubModel.reopenFiles).to.have.been.calledWith(
                    workspaceUri,
                    {
                        chnum: "99",
                        files: [
                            { fsPath: basicFiles.add().localFile.fsPath },
                            { fsPath: basicFiles.edit().localFile.fsPath }
                        ]
                    }
                );
            });
            it("Cannot move shelved files", async () => {
                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );
                const resource2 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit()
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

                items.stubModel.inputChangeSpec.rejects("My change error");

                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );

                await PerforceSCMProvider.ReopenFile(resource1 as Resource);
                expect(items.showImportantError).to.have.been.calledWith(
                    "My change error"
                );
                expect(items.stubModel.reopenFiles).not.to.have.been.called;
            });
        });
        describe("Fix a Job", () => {
            it("Fixes a perforce job", async () => {
                sinon.stub(vscode.window, "showInputBox").resolves("job00001");
                await PerforceSCMProvider.FixJob(items.instance.resources[1]);

                expect(items.stubModel.fixJob).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    jobId: "job00001"
                });

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

                expect(items.stubModel.fixJob).not.to.have.been.called;
            });
            it("Can handle an error fixing a perforce job", async () => {
                sinon.stub(vscode.window, "showInputBox").resolves("job00001");
                items.stubModel.fixJob.rejects("My fix error");

                await PerforceSCMProvider.FixJob(items.instance.resources[1]);

                expect(items.showImportantError).to.have.been.calledWith("My fix error");
            });
        });
        describe("Unfix a Job", () => {
            it("Displays a list of fixed jobs to unfix", async () => {
                items.stubModel.changelists[0].jobs = [
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

                expect(items.stubModel.fixJob).not.to.have.been.called;
            });
            it("Unfixes a perforce job", async () => {
                items.stubModel.changelists[0].jobs = [
                    { name: "job00001", description: ["a job"] }
                ];
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });
                await PerforceSCMProvider.UnfixJob(items.instance.resources[1]);

                expect(items.stubModel.fixJob).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    jobId: "job00001",
                    removeFix: true
                });
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

                expect(items.stubModel.fixJob).not.to.have.been.called;
            });
            it("Can handle an error unfixing a perforce job", async () => {
                items.stubModel.changelists[0].jobs = [
                    { name: "job00001", description: ["a job"] }
                ];
                sinon.stub(vscode.window, "showQuickPick").callsFake(items => {
                    return Promise.resolve((items as vscode.QuickPickItem[])[0]);
                });
                items.stubModel.fixJob.rejects("My fix error");

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
                    basicFiles.edit()
                );

                await PerforceSCMProvider.Revert(resource as Resource);

                expect(prompt).to.be.calledOnce;
                expect(items.stubModel.revert).not.to.have.been.called;
            });
            it("Reverts an open file", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                const resource = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.edit()
                );

                await PerforceSCMProvider.Revert(resource as Resource);

                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    paths: [{ fsPath: basicFiles.edit().localFile.fsPath }],
                    unchanged: undefined
                });
            });
            it("Can revert multiple files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.add()
                );

                const resource2 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.delete()
                );

                await PerforceSCMProvider.Revert(resource1 as Resource, resource2);

                expect(warn).to.have.been.calledTwice;

                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    paths: [{ fsPath: basicFiles.add().localFile.fsPath }],
                    unchanged: undefined
                });
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    paths: [{ fsPath: basicFiles.delete().localFile.fsPath }],
                    unchanged: undefined
                });
            });
            it("Cannot revert a shelved file", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                const resource1 = findResourceForFile(
                    items.instance.resources[1],
                    basicFiles.moveAdd()
                );

                const resource2 = findResourceForShelvedFile(
                    items.instance.resources[1],
                    basicFiles.shelveEdit()
                );

                await PerforceSCMProvider.Revert(resource1 as Resource, resource2);

                expect(items.stubModel.revert).to.have.been.calledOnce;
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    paths: [{ fsPath: basicFiles.moveAdd().localFile.fsPath }],
                    unchanged: undefined
                });

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
                    basicFiles.edit()
                );

                await PerforceSCMProvider.RevertUnchanged(resource as Resource);

                expect(warn).not.to.have.been.called;
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    paths: [{ fsPath: basicFiles.edit().localFile.fsPath }],
                    unchanged: true
                });
            });
        });
        describe("Revert changelist", () => {
            it("Prompts the user for confirmation", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolves(undefined);

                await PerforceSCMProvider.Revert(items.instance.resources[1]);

                expect(warn).to.have.been.calledOnce;
                expect(items.stubModel.revert).not.to.have.been.called;
            });
            it("Reverts a changelist and deletes it", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.Revert(items.instance.resources[2]);

                expect(warn).to.have.been.calledOnce;
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    chnum: "2",
                    paths: ["//..."],
                    unchanged: undefined
                });
                expect(
                    items.stubModel.deleteChangelist
                ).to.have.been.calledWith(workspaceUri, { chnum: "2" });
            });
            it("Can revert the default changelist and does not attempt to delete it", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.Revert(items.instance.resources[0]);

                expect(warn).to.have.been.calledOnce;
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    chnum: "default",
                    paths: ["//..."],
                    unchanged: undefined
                });

                expect(items.stubModel.deleteChangelist).not.to.have.been.called;
            });
            it("Does not try to delete a changelist with shelved files", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.Revert(items.instance.resources[1]);

                expect(warn).to.have.been.calledOnce;

                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    chnum: "1",
                    paths: ["//..."],
                    unchanged: undefined
                });
                expect(items.stubModel.deleteChangelist).not.to.have.been.called;
            });
            it("Can revert if unchanged", async () => {
                const warn = sinon
                    .stub(vscode.window, "showWarningMessage")
                    .resolvesArg(2);

                await PerforceSCMProvider.RevertUnchanged(items.instance.resources[2]);

                expect(warn).not.to.have.been.called;
                expect(items.stubModel.revert).to.have.been.calledWith(workspaceUri, {
                    chnum: "2",
                    paths: ["//..."],
                    unchanged: true
                });
                expect(
                    items.stubModel.deleteChangelist
                ).to.have.been.calledWith(workspaceUri, { chnum: "2" });
            });
            it("Can handle an error reverting a changelist", async () => {
                sinon.stub(vscode.window, "showWarningMessage").resolvesArg(2);

                items.stubModel.revert.rejects("My revert error");

                await PerforceSCMProvider.RevertUnchanged(items.instance.resources[2]);

                // showError not called - because stub model doesn't do this, but Utils.runCommand does!
                // expect(items.showError).to.have.been.calledWith("My revert error");
                // TODO - suggests all the other things that do call this are probably duplicating the error as this should already be done by runCommand

                // it still tries to delete, even with an error - because the changelist may already be empty
                expect(
                    items.stubModel.deleteChangelist
                ).to.have.been.calledWith(workspaceUri, { chnum: "2" });
            });
        });
    });
});
