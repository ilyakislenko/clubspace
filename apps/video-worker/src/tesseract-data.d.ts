// The English traineddata, shipped as an npm package so OCR works offline
// (tesseract.js otherwise downloads it from a CDN on first use). Untyped.
declare module '@tesseract.js-data/eng' {
    const data: {
        code: string
        gzip: boolean
        /** The legacy+LSTM model directory; 4.0.0_best_int sits next to it. */
        langPath: string
    }
    export default data
}
