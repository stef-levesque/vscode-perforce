import { pipe } from "@arrows/composition";
import {
    concatIfOutputIsDefined,
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    removeLeadingNewline,
    splitIntoLines,
    removeIndent,
    splitIntoSections
} from "../CommandUtils";
import { RawField, ChangeSpec } from "../CommonTypes";

const parseRawField = pipe(removeLeadingNewline, splitIntoLines, removeIndent);

function parseRawFields(parts: string[]): RawField[] {
    return parts.map(field => {
        const colPos = field.indexOf(":");
        const name = field.slice(0, colPos);
        const value = parseRawField(field.slice(colPos + 2));
        return { name, value };
    });
}

const getBasicField = (fields: RawField[], field: string) =>
    fields.find(i => i.name === field)?.value;

const excludeNonFields = (parts: string[]) =>
    parts.filter(part => !part.startsWith("#") && part !== "");

function mapToChangeFields(rawFields: RawField[]): ChangeSpec {
    return {
        change: getBasicField(rawFields, "Change")?.[0].trim(),
        description: getBasicField(rawFields, "Description")?.join("\n"),
        files: getBasicField(rawFields, "Files")?.map(file => {
            // exmample:
            //   //depot/TestArea/doc3.txt       # add
            //   //depot/TestArea/My initial text document.txt   # edit
            //   //depot/TestArea/my next document.txt   # delete
            const endOfFileStr = file.indexOf("#");
            return {
                depotPath: file.slice(0, endOfFileStr).trim(),
                action: file.slice(endOfFileStr + 2)
            };
        }),
        rawFields
    };
}

const parseChangeSpec = pipe(
    splitIntoSections,
    excludeNonFields,
    parseRawFields,
    mapToChangeFields
);

const getChangeAsRawField = (spec: ChangeSpec) =>
    spec.change ? { name: "Change", value: [spec.change] } : undefined;

const getDescriptionAsRawField = (spec: ChangeSpec) =>
    spec.description
        ? { name: "Description", value: splitIntoLines(spec.description) }
        : undefined;

const getFilesAsRawField = (spec: ChangeSpec) =>
    spec.files
        ? {
              name: "Files",
              value: spec.files.map(file => file.depotPath + "\t# " + file.action)
          }
        : undefined;

function getDefinedSpecFields(spec: ChangeSpec): RawField[] {
    return concatIfOutputIsDefined(
        getChangeAsRawField,
        getDescriptionAsRawField,
        getFilesAsRawField
    )(spec);
}

export type ChangeSpecOptions = {
    existingChangelist?: string;
};

const changeFlags = flagMapper<ChangeSpecOptions>([], "existingChangelist", ["-o"], {
    lastArgIsFormattedArray: true
});

const outputChange = makeSimpleCommand("change", changeFlags);

export const getChangeSpec = asyncOuputHandler(outputChange, parseChangeSpec);

export type InputChangeSpecOptions = {
    spec: ChangeSpec;
};

export type CreatedChangelist = {
    rawOutput: string;
    chnum?: string;
};

function parseCreatedChangelist(createdStr: string): CreatedChangelist {
    const matches = /Change\s(\d+)\s/.exec(createdStr);
    return {
        rawOutput: createdStr,
        chnum: matches?.[1]
    };
}

const inputChange = makeSimpleCommand(
    "change",
    () => ["-i"],
    (options: InputChangeSpecOptions) => {
        return {
            input:
                getDefinedSpecFields(options.spec)
                    .concat(
                        options.spec.rawFields.filter(
                            field =>
                                !options.spec[
                                    field.name.toLowerCase() as keyof ChangeSpec
                                ]
                        )
                    )
                    .map(field => field.name + ":\t" + field.value.join("\n\t"))
                    .join("\n\n") + "\n\n" // perforce doesn't like an empty raw field on the end without newlines
        };
    }
);

export const inputChangeSpec = asyncOuputHandler(inputChange, parseCreatedChangelist);
