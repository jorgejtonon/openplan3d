//! DXF to DWG conversion for the OpenPlan3D drawing editor.
//!
//! The editor keeps drawings in its own database and exports DXF; this module reads that DXF with
//! acadrust (MPL-2.0) and writes it back as native DWG, so drawings can be saved in AutoCAD's
//! format from the phone. Compiled to WebAssembly and run in a web worker.

use acadrust::{DwgWriter, DxfReader, DxfVersion};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

/// DWG version from the AutoCAD release year asked for (2004, 2007, 2010, 2013 or 2018).
pub fn version_for(year: u32) -> DxfVersion {
    match year {
        2000 => DxfVersion::AC1015,
        2004 => DxfVersion::AC1018,
        2007 => DxfVersion::AC1021,
        2010 => DxfVersion::AC1024,
        2018 => DxfVersion::AC1032,
        _ => DxfVersion::AC1027,
    }
}

/// Converts DXF bytes (ASCII or binary) into DWG bytes of the given AutoCAD release.
pub fn convert(dxf: &[u8], year: u32) -> Result<Vec<u8>, String> {
    let mut document = DxfReader::from_reader(Cursor::new(dxf.to_vec()))
        .and_then(|reader| reader.read())
        .map_err(|error| format!("DXF ilegível: {error}"))?;
    document.version = version_for(year);
    DwgWriter::write_to_vec(&document).map_err(|error| format!("falha ao gravar DWG: {error}"))
}

/// WebAssembly entry: DXF in, DWG out.
#[wasm_bindgen]
pub fn dxf_to_dwg(dxf: &[u8], year: u32) -> Result<Vec<u8>, JsError> {
    convert(dxf, year).map_err(|message| JsError::new(&message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use acadrust::DwgReader;

    fn template() -> Vec<u8> {
        std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/templates/novo-m.dxf")).expect("template")
    }

    #[test]
    fn writes_dwg_that_reads_back() {
        for year in [2004, 2013, 2018] {
            let dwg = convert(&template(), year).expect("convert");
            let expected = match year { 2004 => "AC1018", 2018 => "AC1032", _ => "AC1027" };
            assert_eq!(&dwg[..6], expected.as_bytes());
            let back = DwgReader::from_stream(Cursor::new(dwg)).read().expect("read back");
            assert!(back.layers.iter().any(|layer| layer.name == "REDE-ESGOTO"));
        }
    }

    #[test]
    fn reports_bad_input() {
        assert!(convert(b"not a drawing", 2013).is_err());
    }
}
