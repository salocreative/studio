/**
 * Generate a thumbnail from the first page of a PDF
 * Returns a Blob containing the thumbnail image (PNG format)
 */
export async function generatePdfThumbnail(file: File, maxWidth: number = 400, maxHeight: number = 400): Promise<Blob | null> {
  try {
    // Dynamically import pdfjs-dist
    const pdfjsLib = await import('pdfjs-dist')
    
    // Set worker source - use local worker file from public folder
    // This avoids CDN issues and works reliably in all environments
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
    
    // Load the PDF
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    
    // Get the first page
    const page = await pdf.getPage(1)
    
    // Calculate scale to fit within max dimensions
    const viewport = page.getViewport({ scale: 1.0 })
    const scale = Math.min(maxWidth / viewport.width, maxHeight / viewport.height, 2.0) // Max 2x scale for quality
    const scaledViewport = page.getViewport({ scale })
    
    // Create canvas
    const canvas = document.createElement('canvas')
    canvas.width = scaledViewport.width
    canvas.height = scaledViewport.height
    
    const context = canvas.getContext('2d')
    if (!context) {
      console.error('Failed to get canvas context')
      return null
    }
    
    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: scaledViewport,
      canvas: canvas,
    }).promise
    
    // Convert canvas to blob
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob)
      }, 'image/png', 0.9) // PNG format with 90% quality
    })
  } catch (error) {
    console.error('Error generating PDF thumbnail:', error)
    return null
  }
}

