const SHEET_ID = "YOUR_SHEET_ID_HERE"; // replace with your actual sheet ID

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SHEET_ID);

    // Applications tab
    let appsSheet = ss.getSheetByName("Applications");
    if (!appsSheet) {
      appsSheet = ss.insertSheet("Applications");
      appsSheet.appendRow(["Job ID","Company","Role","Location","Apply URL","Status","Platform","Resume URL","Applied At","Notes"]);
    }
    appsSheet.appendRow([
      data.jobId, data.company, data.role, data.location,
      data.applyUrl, data.status, data.platform,
      data.resumeUrl, data.appliedAt, data.notes
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
