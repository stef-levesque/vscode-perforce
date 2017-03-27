import { Uri, EventEmitter, Event, SCMResourceGroup, Disposable, window } from 'vscode';
import { Utils } from '../Utils';
import { Resource } from './Resource';
import { ResourceGroup, DefaultGroup, PendingGroup, ShelvedGroup } from './ResourceGroups';

import * as Path from 'path';


export class Model implements Disposable {
    private _disposables: Disposable[] = [];

    private _onDidChange = new EventEmitter<SCMResourceGroup[]>();
    public get onDidChange(): Event<SCMResourceGroup[]> {
        return this._onDidChange.event;
    }

    public dispose() {
        if (this._disposables) {
            this._disposables.forEach(d => d.dispose());
            this._disposables = [];
        }
    }

    private _defaultGroup?: DefaultGroup = null;
    private _pendingGroups: PendingGroup[] = [];
    private _shelvedGroups: ShelvedGroup[] = [];

    public get Resources(): ResourceGroup[] {
        const result: ResourceGroup[] = [];

        if (this._defaultGroup)
            result.push(this._defaultGroup);
        
        this._pendingGroups.forEach((value) => {
            result.push(value);
        });

        this._shelvedGroups.forEach((value) => {
            result.push(value);
        });
        
        return result;
    }

    public constructor() {}

    public async Refresh(): Promise<void> {
        window.withScmProgress( () => this.update() );
    }

    private async update(): Promise<void> {
        const output: string = await Utils.getOutput('opened');
        var opened = output.trim().split('\n')
        if (opened.length === 0) {
            return;
        }

        let defaults: Resource[] = [];
        let pendings = new Map<number, Resource[]>();
        let shelved = new Map<number, Resource[]>();

        for (let i = 0, n = opened.length; i < n; ++i) {
            // depot-file#rev - action chnum change (type) [lock-status]
            const matches = opened[i].match(/(.+)#(\d+)\s-\s([\w\/]+)\s(default\schange|change\s\d+)\s\((\w+)\)/);

            if (matches) {
                const depotFile = matches[1];
                const rev = matches[2];
                const action = matches[3];
                const change = matches[4];
                const type = matches[5];

                const output: string = await Utils.getOutput('fstat', depotFile, null, '-T clientFile');

                if (output.indexOf('... clientFile ') === 0) {
                    const clientFile = output.substring(15, output.indexOf('\n')).trim();
                    const uri = Uri.file(clientFile);
                    const resource: Resource = new Resource(uri, change, action);

                    if (change === 'default change') {
                        defaults.push(resource);
                    } else {
                        let chnum: number = parseInt( change.substr(change.indexOf(' ')).trim() );

                        if (!pendings.has(chnum)) {
                            pendings.set(chnum, []);
                        }
                        pendings.get(chnum).push(resource);
                    }
                }
            }

        }

        //TODO shelved

        this._defaultGroup = new DefaultGroup(defaults);
        this._pendingGroups = [];
        pendings.forEach( (value, key) => {
            const pending = new PendingGroup(key, value)
            return this._pendingGroups.push(pending);
        })

        this._onDidChange.fire(this.Resources);

    }
}