const { parse } = require("csv-parse");

function readCsvBuffer(buf) {
    return new Promise((resolve, reject) => {
        const rows = [];
        parse(buf, { columns: true, bom: true, skip_empty_lines: true })
            .on("readable", function () { let r; while ((r = this.read())) rows.push(r); })
            .on("end", () => resolve(rows))
            .on("error", reject);
    });
}
module.exports = { readCsvBuffer };
