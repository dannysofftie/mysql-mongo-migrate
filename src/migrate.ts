import { database } from './configs/dbconfig';
import * as fs from 'fs';
import * as path from 'path';
import datatypes from './utils/datatypes';

/**
 * Database migration utility. WIll migrate data from MySQL to MongoDb,
 * MySQL database name will be retained. All MySQL table names will be mapped to MongoDb collections,
 * MySQL model relationships will not be reinforced since MongoDB does not support schema relationships
 *
 * @export
 * @class Migrate
 */
export class Migrate {
    private models: string | any[];
    private datafilesdir: string;
    private modelsdirectory: string;
    private modelschemas: Map<string, string>;

    constructor() {
        this.datafilesdir = path.join(__dirname, `../data-files/`);
        this.modelsdirectory = path.join(__dirname, `../mongo-models/`);
        this.modelschemas = new Map();
    }

    /**
     * Retrieve all model names from provided database
     *
     * @memberof Migrate
     */
    public async retrieveModels(): Promise<void> {
        const modelInfo = await database.query(`show full tables where Table_Type = 'BASE TABLE'`);
        this.models = modelInfo.map((res) => {
            return res[Object.keys(res)[0]];
        });
    }

    /**
     * Retrieve data for each model from MySQL
     *
     * @memberof Migrate
     */
    public async retrieveMysqlData(): Promise<void> {
        if (this.models === undefined) {
            throw new Error(`Call retrieveModels to get MySQL models!`);
        }
        try {
            const files = await fs.readdirSync(this.datafilesdir);
            if (files.length) {
                for await (const file of files) {
                    fs.unlinkSync(this.datafilesdir + file);
                }
            }
        } catch {
            fs.mkdirSync(this.datafilesdir);
        }

        for await (const model of this.models) {
            const modelData = await database.query(`select * from ${model}`);
            fs.writeFileSync(`${this.datafilesdir + model}.json`, JSON.stringify(modelData));
        }
        console.log(
            `Found ${this.models.length} models and ` + 'wrote into json files in ' + Math.floor(process.uptime()) + 's and ',
            process
                .uptime()
                .toString()
                .split('.')[1] + 'ms\nMapping into MongoDB collections ....',
        );
    }

    /**
     * Generate MongoDB Schemas with corresponding data types as from MySQL
     *
     * @memberof Migrate
     */
    public async generateMongoSchemas(): Promise<void> {
        const schemafiles: string[] = fs.readdirSync(this.datafilesdir);
        if (schemafiles.length < 1) {
            throw new Error('Empty directory!');
        }

        try {
            // delete previously generated models if any
            const models = fs.readdirSync(this.modelsdirectory);
            models.forEach((model) => {
                fs.unlinkSync(this.modelsdirectory + model);
            });
            // tslint:disable-next-line:no-empty
        } catch (error) {}

        for await (const schemafile of schemafiles) {
            let modelname: string = schemafile.split('.')[0];
            const definition: any[] = await database.query(`describe ${modelname}`);
            if (modelname.indexOf('_') !== -1) {
                modelname = modelname.split('_').join('');
            }
            modelname = modelname.slice(0, 1).toUpperCase() + modelname.slice(1);
            // add key value pairs to modelschemas, to map data-files to their corresponding mongo-model files
            this.modelschemas.set(schemafile, modelname);
            try {
                fs.mkdirSync(this.modelsdirectory);
            } catch {
                // do nothing if `models` directory exists
            } finally {
                const model: fs.WriteStream = fs.createWriteStream(`${this.modelsdirectory + modelname}.ts`);
                model.write(`import { Schema, model } from 'mongoose';\n\n`);

                let modeldefinition: string = '';

                for await (const field of definition) {
                    const datatype = field.Type.indexOf('(') !== -1 ? field.Type.split('(')[0] : field.Type;
                    modeldefinition += `
                    ${field.Field}: {
                            type: ${datatypes[datatype]},
                            required: ${field.Null === 'YES' ? false : true},
                            default: ${field.Default === 'CURRENT_TIMESTAMP' ? 'Date.now' : field.Default},
                    },`;
                }

                model.write(`const ${modelname} = new Schema({${modeldefinition}});`);
                model.write(`\n\n\n\nexport default model('${modelname}', ${modelname});\n`);
            }
        }
    }

    /**
     * Write / populate retrieved data into MongoDB, using generated Schemas
     *
     * @returns {Promise<void>}
     * @memberof Migrate
     */
    public async populateMongo(): Promise<void> {
        if (this.modelschemas.size) {
            for (const datafile of this.modelschemas) {
                const modeldata: string[] = JSON.parse(fs.readFileSync(this.datafilesdir + datafile[0], 'utf-8'));
                console.log(modeldata);
            }
        }
    }
}
