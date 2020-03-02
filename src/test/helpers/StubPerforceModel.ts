import * as sinon from "sinon";
import * as vscode from "vscode";
import * as p4 from "../../api/PerforceApi";

import { ChangeInfo, ChangeSpec, FixedJob, FstatInfo } from "../../api/CommonTypes";
import { Status } from "../../scm/Status";
import { PerforceService } from "../../PerforceService";
import { getStatusText } from "./testUtils";

type PerforceResponseCallback = (
    err: Error | null,
    stdout: string,
    stderr: string
) => void;

export interface StubJob {
    name: string;
    description: string[];
}

export interface StubChangelist {
    chnum: string;
    description: string;
    submitted?: boolean;
    files: StubFile[];
    shelvedFiles?: StubFile[];
    jobs?: StubJob[];
}

export interface StubFile {
    localFile: vscode.Uri;
    suppressFstatClientFile?: boolean;
    depotPath: string;
    depotRevision: number;
    operation: Status;
    fileType?: string;
    resolveFromDepotPath?: string;
    resolveEndFromRev?: number;
}

export function stubExecute() {
    return sinon.stub(PerforceService, "execute").callsFake(executeStub);
}

function executeStub(
    _resource: vscode.Uri,
    command: string,
    responseCallback: PerforceResponseCallback,
    _args?: string[],
    _directoryOverride?: string | null,
    _input?: string
) {
    setImmediate(() => {
        responseCallback(null, command, "");
    });
}

function makeDefaultInfo(resource: vscode.Uri) {
    const ret = new Map<string, string>();
    ret.set("User name", "user");
    ret.set("Client name", "cli");
    ret.set("Client root", resource.fsPath);
    ret.set("Current directory", resource.fsPath);
    return Promise.resolve(ret);
}

export class StubPerforceModel {
    public changelists: StubChangelist[];

    public isLoggedIn: sinon.SinonStub<any>;
    public deleteChangelist: sinon.SinonStub<any>;
    public fixJob: sinon.SinonStub<any>;
    public getChangeSpec: sinon.SinonStub<any>;
    public getChangelists: sinon.SinonStub<any>;
    public getFixedJobs: sinon.SinonStub<any>;
    public getFstatInfo: sinon.SinonStub<any>;
    public getInfo: sinon.SinonStub<any>;
    public getOpenedFiles: sinon.SinonStub<any>;
    public getShelvedFiles: sinon.SinonStub<any>;
    public haveFile: sinon.SinonStub<any>;
    public reopenFiles: sinon.SinonStub<any>;
    public revert: sinon.SinonStub<any>;
    public shelve: sinon.SinonStub<any>;
    public submitChangelist: sinon.SinonStub<any>;
    public sync: sinon.SinonStub<any>;
    public unshelve: sinon.SinonStub<any>;
    public inputChangeSpec: sinon.SinonStub<any>;

    constructor() {
        this.changelists = [];

        this.isLoggedIn = sinon.stub(p4, "isLoggedIn").resolves(true);
        this.deleteChangelist = sinon
            .stub(p4, "deleteChangelist")
            .resolves("changelist deleted");
        this.fixJob = sinon.stub(p4, "fixJob").resolves("job fixed");
        this.getChangeSpec = sinon
            .stub(p4, "getChangeSpec")
            .callsFake(this.resolveChangeSpec.bind(this));
        this.getChangelists = sinon
            .stub(p4, "getChangelists")
            .callsFake(this.resolveChangelists.bind(this));
        this.getFixedJobs = sinon
            .stub(p4, "getFixedJobs")
            .callsFake(this.resolveFixedJobs.bind(this));
        this.getFstatInfo = sinon
            .stub(p4, "getFstatInfo")
            .callsFake(this.fstatFiles.bind(this));
        this.getInfo = sinon.stub(p4, "getInfo").callsFake(makeDefaultInfo);
        this.getOpenedFiles = sinon
            .stub(p4, "getOpenedFiles")
            .callsFake(this.resolveOpenFiles.bind(this));
        this.getShelvedFiles = sinon
            .stub(p4, "getShelvedFiles")
            .callsFake(this.resolveShelvedFiles.bind(this));
        this.haveFile = sinon.stub(p4, "haveFile").resolves(true);
        this.reopenFiles = sinon.stub(p4, "reopenFiles").resolves("reopened");
        this.revert = sinon.stub(p4, "revert").resolves("reverted");
        this.shelve = sinon.stub(p4, "shelve").resolves("shelved");
        this.submitChangelist = sinon.stub(p4, "submitChangelist").resolves({
            rawOutput: "submitting...\n change 250 submitted",
            chnum: "250"
        });
        this.sync = sinon.stub(p4, "sync").resolves("synced");
        this.unshelve = sinon.stub(p4, "unshelve").resolves("unshelved");
        this.inputChangeSpec = sinon
            .stub(p4, "inputChangeSpec")
            .resolves({ chnum: "99", rawOutput: "Change 99 created" });
    }

    resolveOpenFiles(
        _resource: vscode.Uri,
        options: p4.OpenedFileOptions
    ): Promise<string[]> {
        return Promise.resolve(
            this.changelists
                .filter(cl => (options.chnum ? cl.chnum === options.chnum : true))
                .flatMap(cl => cl.files.map(file => file.depotPath))
        );
    }

    resolveChangelists(): Promise<ChangeInfo[]> {
        // Note - doesn't take account of options! (TODO if required)
        return Promise.resolve(
            this.changelists
                .filter(cl => !cl.submitted && cl.chnum !== "default")
                .map<ChangeInfo>(cl => {
                    return {
                        chnum: cl.chnum,
                        date: "01/01/2020",
                        client: "cli",
                        user: "user",
                        description: cl.description,
                        status: "*pending*"
                    };
                })
        );
    }

    resolveFixedJobs(
        _resource: vscode.Uri,
        options: p4.GetFixedJobsOptions
    ): Promise<FixedJob[]> {
        const cl = this.changelists.find(cl => cl.chnum === options.chnum);
        if (!cl) {
            return Promise.reject("Changelist does not exist");
        }
        return Promise.resolve(
            cl.jobs?.map<FixedJob>(job => {
                return { description: job.description, id: job.name };
            }) ?? []
        );
    }

    resolveShelvedFiles(
        _resource: vscode.Uri,
        options: p4.GetShelvedOptions
    ): Promise<p4.ShelvedChangeInfo[]> {
        return Promise.resolve(
            this.changelists
                .filter(cl => options.chnums.includes(cl.chnum))
                .map(cl => {
                    return {
                        chnum: parseInt(cl.chnum),
                        paths: cl.shelvedFiles?.map(s => s.depotPath)
                    };
                })
                .filter((cl): cl is p4.ShelvedChangeInfo => cl.paths !== undefined)
        );
    }

    /*private withoutUndefined<T>(obj: { [key: string]: T }) {
        return Object.entries(obj).reduce((all, cur) => {
            if (cur[1] !== undefined && cur[1] !== null) {
                all[cur[0]] = cur[1];
            }
            return all;
        }, {} as { [key: string]: T });
    }*/

    fstatFile(
        depotPath: string,
        chnum?: string,
        shelved?: boolean
    ): FstatInfo | undefined {
        const cl = this.changelists.find(c =>
            chnum ? c.chnum === chnum : c.files.some(file => file.depotPath === depotPath)
        );
        const file = shelved
            ? cl?.shelvedFiles?.find(file => file.depotPath === depotPath)
            : cl?.files.find(file => file.depotPath === depotPath);

        if (file) {
            return {
                depotFile: depotPath,
                clientFile: file.suppressFstatClientFile
                    ? undefined
                    : file.localFile.fsPath,
                isMapped: "true",
                haveRev: file.depotRevision.toString(),
                headType: file.fileType ?? "text",
                action: getStatusText(file.operation),
                workRev: file.depotRevision?.toString(),
                change: cl?.chnum,
                resolveFromFile0: file.resolveFromDepotPath,
                resolveEndFromRev0: file.resolveEndFromRev?.toString()
            } as FstatInfo;
        }
    }

    fstatFiles(
        _resource: vscode.Uri,
        options: p4.FstatOptions
    ): Promise<(FstatInfo | undefined)[]> {
        const files = options.depotPaths.map(path =>
            this.fstatFile(path, options.chnum, options.limitToShelved)
        );
        return Promise.resolve(files);
        //return Promise.reject("implement me");
    }

    resolveChangeSpec(
        _resource: vscode.Uri,
        options: p4.ChangeSpecOptions
    ): Promise<ChangeSpec> {
        if (options.existingChangelist) {
            const cl = this.changelists.find(
                cl => cl.chnum === options.existingChangelist
            );
            if (!cl) {
                return Promise.reject("No such changelist " + options.existingChangelist);
            }
            return Promise.resolve<ChangeSpec>({
                change: options.existingChangelist,
                description: cl.description,
                files: cl.files.map(file => {
                    return {
                        action: getStatusText(file.operation),
                        depotPath: file.depotPath
                    };
                }),
                rawFields: [{ name: "A field", value: ["don't know"] }]
            });
        }
        const cl = this.changelists.find(cl => cl.chnum === "default");
        return Promise.resolve<ChangeSpec>({
            description: "<Enter description>",
            files: cl?.files.map(file => {
                return {
                    action: getStatusText(file.operation),
                    depotPath: file.depotPath
                };
            }),
            rawFields: [{ name: "A field", value: ["don't know"] }]
        });
    }
}
