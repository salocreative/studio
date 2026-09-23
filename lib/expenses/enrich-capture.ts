import { downloadCaptureFile } from '@/lib/xero/bills'
import {
  cleanFileName,
  extractAmountFromText,
  extractPdfText,
  filenameFromDriveTitle,
  htmlToText,
  inferExpenseDocumentKind,
  type ExpenseDocumentKind,
} from '@/lib/expenses/parse-document'

export interface CaptureEnrichment {
  fileName: string | null
  amount: number | null
  documentKind: ExpenseDocumentKind
}

function driveFileId(fileUrl: string): string | null {
  const fromPath = /\/d\/([^/]+)/.exec(fileUrl)?.[1]
  if (fromPath) return fromPath
  const fromQuery = /[?&]id=([^&]+)/.exec(fileUrl)?.[1]
  return fromQuery ? decodeURIComponent(fromQuery) : null
}

async function filenameFromDrivePage(fileUrl: string): Promise<string | null> {
  const fileId = driveFileId(fileUrl)
  if (!fileId) return null
  try {
    const response = await fetch(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`, {
      redirect: 'follow',
      headers: { Accept: 'text/html' },
    })
    if (!response.ok) return null
    return filenameFromDriveTitle(await response.text())
  } catch {
    return null
  }
}

export async function enrichExpenseCapture(input: {
  fileUrl: string
  fileType: 'pdf' | 'html'
  fileName?: string | null
  emailSubject?: string | null
  amount?: number | null
}): Promise<CaptureEnrichment> {
  let fileName = cleanFileName(input.fileName)
  let amount = input.amount != null && input.amount > 0 ? input.amount : null
  let text = ''

  const needsAmount = amount == null
  const needsKindText = inferExpenseDocumentKind(fileName, input.emailSubject) === 'other'
  if (needsAmount || needsKindText || !fileName) {
    const file = await downloadCaptureFile(input.fileUrl)
    if (!('error' in file)) {
      if (!fileName) fileName = cleanFileName(file.fileName)
      const isHtml = input.fileType === 'html' || file.contentType.includes('text/html')
      text = isHtml ? htmlToText(new TextDecoder().decode(file.bytes)) : extractPdfText(file.bytes)
      if (amount == null) amount = extractAmountFromText(text)
    }
  }

  if (!fileName) fileName = await filenameFromDrivePage(input.fileUrl)

  const documentKind = inferExpenseDocumentKind(fileName, input.emailSubject, text)
  return {
    fileName,
    amount: documentKind === 'statement' ? null : amount,
    documentKind,
  }
}
