import type { DiffOp } from './line-diff'
import {
  diffPre,
  escapeHtml,
  formatTime,
  toolPage,
} from './wiki-page'

type RevisionRow = {
  id: number
  editorUserId: string
  editorName: string
  source: string
  revertedFromId: number | null
  createdAt: number
}

export function historyPageHtml(
  rows: RevisionRow[],
  diff:
    | {
        fromId: number
        toId: number
        ops: DiffOp[]
      }
    | null,
): string {
  const fromSelected = diff?.fromId ?? rows[1]?.id ?? rows[0]?.id
  const toSelected = diff?.toId ?? rows[0]?.id
  const fromOpts = rows
    .map(
      (row) =>
        `<option value="${row.id}"${row.id === fromSelected ? ' selected' : ''}>#${row.id}</option>`,
    )
    .join('')
  const toOpts = rows
    .map(
      (row) =>
        `<option value="${row.id}"${row.id === toSelected ? ' selected' : ''}>#${row.id}</option>`,
    )
    .join('')

  const tableRows = rows
    .map(
      (row) => `<tr>
<td><a href="/api/wiki/html?revisionId=${row.id}">#${row.id}</a></td>
<td>${escapeHtml(row.source)}${row.revertedFromId != null ? ` ← #${row.revertedFromId}` : ''}</td>
<td>${escapeHtml(row.editorName)}</td>
<td>${escapeHtml(formatTime(row.createdAt))}</td>
<td><input type="button" value="Revert" data-revision="${row.id}"></td>
</tr>`,
    )
    .join('\n')

  const diffBlock = diff
    ? `<h2>Diff #${diff.fromId} → #${diff.toId}</h2>\n${diffPre(diff.ops)}`
    : ''

  const body = `<h1>History</h1>
<form action="/api/wiki/history" method="get">
<p>
From <select name="from">${fromOpts}</select>
to <select name="to">${toOpts}</select>
<input type="submit" value="View diff">
</p>
</form>
${diffBlock}
<table>
<tr><th>#</th><th>source</th><th>editor</th><th>when</th><th></th></tr>
${tableRows}
</table>
<p id="err"></p>
<script>
document.querySelectorAll("[data-revision]").forEach(function (btn) {
  btn.onclick = async function () {
    var id = btn.getAttribute("data-revision")
    if (!confirm("This creates a new revision with the text from #" + id + ". The old revisions stay in history.")) return
    if (btn.disabled) return
    btn.disabled = true
    var err = document.getElementById("err")
    err.textContent = ""
    if (typeof speed === "undefined") {
      err.textContent = "Login script has not loaded yet"
      btn.disabled = false
      return
    }
    try {
      var auth = await speed.auth.getCurrentUser(true)
      if (!auth) {
        btn.disabled = false
        return
      }
      var res = await fetch("/api/wiki/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revisionId: Number(id),
          editorName: auth.user.name
        })
      })
      if (!res.ok) {
        var body = await res.json().catch(function () { return {} })
        err.textContent = body.message || res.statusText
        btn.disabled = false
        return
      }
      location = "/"
    } catch (e) {
      err.textContent = e.message || "Revert failed"
      btn.disabled = false
    }
  }
})
</script>
<script src="/speed-sdk.js"></script>`

  return toolPage('History', 'history', body)
}

export function editPageHtml(text: string): string {
  const body = `<h1>Edit</h1>
<form id="edit" onsubmit="return false">
<p><textarea id="text" name="text" rows="28" cols="80" spellcheck="false">${escapeHtml(text)}</textarea></p>
<p><input type="submit" value="Save"></p>
</form>
<p id="draft"></p>
<p id="err"></p>
<iframe id="preview" sandbox="" width="800" height="480" hidden></iframe>
<script>
var text = document.getElementById("text")
var preview = document.getElementById("preview")
var err = document.getElementById("err")
var previewSeq = 0
var draftKey = "wiki-edit-draft"
var serverText = text.value
var draftNote = document.getElementById("draft")
try {
  var draft = sessionStorage.getItem(draftKey)
  if (draft != null && draft !== serverText) {
    text.value = draft
    draftNote.textContent = "Restored unsaved edit from this tab. "
    var discard = document.createElement("button")
    discard.type = "button"
    discard.textContent = "Discard"
    discard.onclick = function () {
      try {
        sessionStorage.removeItem(draftKey)
      } catch (storageError) {
        draftNote.textContent = storageError.message || "Could not discard unsaved edit"
        return
      }
      text.value = serverText
      draftNote.textContent = ""
      ++previewSeq
      preview.srcdoc = ""
      preview.hidden = true
      err.textContent = ""
    }
    draftNote.appendChild(discard)
  } else if (draft != null) {
    sessionStorage.removeItem(draftKey)
  }
} catch (storageError) {
  draftNote.textContent = storageError.message || "Could not restore unsaved edit"
}
async function showPreview() {
  var seq = ++previewSeq
  try {
    var res = await fetch("/api/wiki/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.value })
    })
    if (seq !== previewSeq) return
    if (!res.ok) {
      var body = await res.json().catch(function () { return {} })
      if (seq !== previewSeq) return
      if (!err.textContent) err.textContent = body.message || res.statusText
      return
    }
    var html = await res.text()
    if (seq !== previewSeq) return
    preview.srcdoc = html
    preview.hidden = false
  } catch (e) {
    if (seq !== previewSeq) return
    if (!err.textContent) err.textContent = e.message || "preview failed"
  }
}
document.getElementById("edit").onsubmit = async function (e) {
  e.preventDefault()
  var btn = e.target.querySelector("[type=submit]")
  if (btn.disabled) return
  btn.disabled = true
  err.textContent = ""
  showPreview()
  var draftError = ""
  try {
    sessionStorage.setItem(draftKey, text.value)
  } catch (storageError) {
    draftError = storageError.message || "Could not keep unsaved edit in this tab"
  }
  if (typeof speed === "undefined") {
    err.textContent = draftError || "Login script has not loaded yet"
    btn.disabled = false
    return
  }
  try {
    var auth = await speed.auth.getCurrentUser(false)
    if (!auth) {
      if (draftError) {
        err.textContent = draftError
        btn.disabled = false
        return
      }
      auth = await speed.auth.getCurrentUser(true)
      if (!auth) {
        btn.disabled = false
        return
      }
    }
    var res = await fetch("/api/wiki", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.value, editorName: auth.user.name })
    })
    if (!res.ok) {
      var body = await res.json().catch(function () { return {} })
      err.textContent = body.message || res.statusText
      btn.disabled = false
      return
    }
    try {
      sessionStorage.removeItem(draftKey)
    } catch (storageError) {
      err.textContent = storageError.message || "Saved, but could not clear the unsaved copy in this tab"
      return
    }
    location = "/"
  } catch (failure) {
    err.textContent = failure.message || "Save failed"
    btn.disabled = false
  }
}
</script>
<script src="/speed-sdk.js"></script>`

  return toolPage('Edit', 'edit', body)
}
