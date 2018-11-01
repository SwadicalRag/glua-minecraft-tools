import * as fs from "fs";
import * as crypto from "crypto";

function SHA1(data: Buffer) {
    return crypto.createHash("sha1").update(data).digest("hex");
}

export interface IDownloadedMod {
	url: string;
	filename: string;
	contents: Buffer;
}

export interface IManifest {
	[sectionName: string]: {
		[modID: string]: {
			filename: string;
			url: string;
			hash: string;
		};
	};
};

import { updateModIDs, formatModTable, parseTable, forEachMod, getListedVersions } from "./md-tools";
import { downloadModFromCurseforge } from "./curseforge-tools";

async function main(argc: number, argv: string[])
{
	if (argc != 5)
	{
		console.error("Usage: ts-node download-mods <mods.md> <targetdir> <targetversion>");
		process.exit(1);
	}

	const data = fs.readFileSync(process.argv[2], "utf-8");
	const lines = data.split("\n");
	const targetDirName = process.argv[3];

	if(!fs.existsSync(targetDirName)) {
		fs.mkdirSync(targetDirName);
	}

	const sections: [string,number][] = [];
	const activeDownloads: Promise<IDownloadedMod>[] = [];

	let manifest: IManifest = {};
	if(fs.existsSync(`${targetDirName}/manifest.json`)) {
		manifest = JSON.parse(fs.readFileSync(`${targetDirName}/manifest.json`).toString());
	}

	let i = 0;
	while (i < lines.length)
	{
		const line = lines[i];

		if (line.indexOf("|") == -1) {
			if(line.trim().charAt(0) === "#") {
				const match = line.trim().match(/^(\#+)\s*([\s\S]*?)\s*$/)
				let priority = 1;
				if(match) {
					priority = match[1].length;

					while(true) {
						let lastSectionPriority = 0;
						if(sections[sections.length - 1]) {
							lastSectionPriority = sections[sections.length - 1][1];
						}
						else {
							break;
						}

						if(priority <= lastSectionPriority) {
							sections.pop()
						}
						else {
							break;
						}
					}

					sections.push([match[2],priority]);
				}
			}
			
			i++;
			continue;
		}
		
		const [nextI, table, columnWidths] = parseTable(lines, i);
		if (table[0][0].toLowerCase() != "mod name")
		{
			i = nextI;
			continue;
		}

		const currentSection = sections.length > 0 ? sections[sections.length - 1][0] : "Misc";
		if(!fs.existsSync(`${targetDirName}/${currentSection}`)) {
			fs.mkdirSync(`${targetDirName}/${currentSection}`);
		}

		manifest[currentSection] = manifest[currentSection] || {};
		
		const versions = getListedVersions(table);
		const versionIdx = versions.indexOf(process.argv[4].trim());
		if(versionIdx === -1) {
			console.error(`Version ${process.argv[4].trim()} not found in [${versions.join(", ")}]`);
		}
		else {
			await forEachMod(table,async (row,namespace,id,urls) => {
				if(row[1].indexOf("✔") === -1) {
					// bad mod!!!!
					// we dont want it!!!!
					return;
				}

				const url = urls[versionIdx];
				if(url === null) {
					console.error("Cannot process " + namespace + ":" + id + " because it has no compatible versions...");
				}
				else {
					// Check if we REALLY need to download this
					if(manifest[currentSection][`${namespace}:${id}`]) {
						const oldFileName = `${targetDirName}/${currentSection}/${manifest[currentSection][`${namespace}:${id}`].filename}`;
						if(fs.existsSync(oldFileName)) {
							if(manifest[currentSection][`${namespace}:${id}`].url === url) {
								let oldData = fs.readFileSync(oldFileName);
								let oldHash = SHA1(oldData);
								if(oldHash !== manifest[currentSection][`${namespace}:${id}`].hash) {
									console.error("Hash mismatch found in " + namespace + ":" + id + "...");
								}
								else {
									console.error("Ignoring " + namespace + ":" + id + " because it already exists...");
									return;
								}
							}

							fs.unlinkSync(oldFileName);
							delete manifest[currentSection][`${namespace}:${id}`];
							fs.writeFileSync(`${targetDirName}/manifest.json`,JSON.stringify(manifest,null,4));
							console.error("Marked " + namespace + ":" + id + " for an update...");
						}
					}

					switch (namespace)
					{
						case "curseforge":
							console.error("Processing " + namespace + ":" + id + "...");

							let dl = downloadModFromCurseforge(url,(progressData) => {
								console.error("Downloading " + namespace + ":" + id + " @ " + `${Math.round(progressData.percent * 1000) / 10}%...`);
							});

							activeDownloads.push(dl);
							dl.then((fileData) => {
								console.error("Saving " + namespace + ":" + id + "...");
								fs.writeFileSync(`${targetDirName}/${currentSection}/${fileData.filename}`,fileData.contents);

								manifest[currentSection][`${namespace}:${id}`] = {
									filename: fileData.filename,
									url,
									hash: SHA1(fileData.contents),
								};
								fs.writeFileSync(`${targetDirName}/manifest.json`,JSON.stringify(manifest,null,4));
							})

							break;
						default:
							console.error(row[0] + ": Unknown id " + namespace + ":" + id + ".");
							break;
					}
				}
			});
		}

		i = nextI;
	}

	await Promise.all(activeDownloads);
}

main(process.argv.length, process.argv);
