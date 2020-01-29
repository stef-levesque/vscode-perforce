import { SinonSpyCall } from "sinon";
import * as vscode from "vscode";
import { Resource } from "../../scm/Resource";
import { Status } from "../../scm/Status";

function assertP4UriMatches(
    Assertion: Chai.AssertionStatic,
    got: vscode.Uri,
    expected: vscode.Uri,
    message: string
) {
    new Assertion(got).to.include(
        {
            scheme: expected.scheme,
            path: expected.path,
            authority: expected.authority,
            fragment: expected.fragment
        },
        message
    );
    new Assertion(got.query).to.have.string(expected.query, message);
}

function resourceToString(resource: Resource) {
    return JSON.stringify(
        {
            uri: resource.uri,
            depotPath: resource.depotPath,
            status: resource.status,
            isShelved: resource.isShelved
        },
        undefined,
        2
    );
}

export default function(chai: Chai.ChaiStatic, _utils: Chai.ChaiUtils) {
    const Assertion = chai.Assertion;

    Assertion.addMethod("p4Uri", function(resource: vscode.Uri) {
        const obj: vscode.Uri = this._obj as vscode.Uri;

        assertP4UriMatches(Assertion, obj, resource, "uri");
    });

    Assertion.addMethod("vscodeOpenCall", function(resource: vscode.Uri) {
        const obj: SinonSpyCall = this._obj as SinonSpyCall;

        new Assertion(obj.args[0]).to.equal("vscode.open");
        assertP4UriMatches(Assertion, obj.args[1], resource, "Resource");
    });

    Assertion.addMethod("vscodeDiffCall", function(
        left: vscode.Uri,
        right: vscode.Uri,
        title: string
    ) {
        const obj: SinonSpyCall = this._obj as SinonSpyCall;

        new Assertion(obj.args[0]).to.equal("vscode.diff");
        assertP4UriMatches(Assertion, obj.args[1], left, "Left Resource");
        assertP4UriMatches(Assertion, obj.args[2], right, "Right Resource");
        new Assertion(obj.args[3]).to.be.string(title, "Title");
    });

    // TODO - this code is excessive - can be simplified - possibly with expect.to.include
    Assertion.addMethod("resources", function(
        expecteds: { depotPath: string; operation: Status }[]
    ) {
        const obj: Resource[] = this._obj as Resource[];

        new Assertion(obj).to.have.length(
            expecteds.length,
            "Unexpected length for resource array"
        );
        expecteds.forEach((expected, i) => {
            const resource: Resource = obj[i];
            new Assertion(resource.depotPath).to.be.equal(
                expected.depotPath,
                "Unexpected depot path for resource " +
                    i +
                    " : " +
                    resourceToString(resource)
            );
            new Assertion(
                resource.status,
                "Resource " + i + "operation mismatch : " + resourceToString(resource)
            ).to.equal(expected.operation);
            new Assertion(
                resource.isShelved,
                "Resource " +
                    i +
                    " should not be marked as shelved : " +
                    resourceToString(resource)
            ).to.be.false;
            // TODO rest of the fields
        });
    });

    Assertion.addMethod("shelvedResources", function(
        expecteds: { depotPath: string; operation: Status }[]
    ) {
        const obj: Resource[] = this._obj as Resource[];

        new Assertion(obj).to.have.length(
            expecteds.length,
            "Unexpected length for shelved resource array"
        );
        expecteds.forEach((expected, i) => {
            const resource: Resource = obj[i];
            new Assertion(resource.depotPath).to.be.equal(
                expected.depotPath,
                "Unexpected depot path for resource " +
                    i +
                    " : " +
                    resourceToString(resource)
            );
            new Assertion(
                resource.status,
                "Shelved resource " +
                    i +
                    "operation mismatch : " +
                    resourceToString(resource)
            ).to.equal(expected.operation);
            new Assertion(
                resource.isShelved,
                "Shelved resource " +
                    i +
                    " should not be marked as shelved : " +
                    resourceToString(resource)
            ).to.be.true;
            // TODO rest of the fields
        });
    });
}
