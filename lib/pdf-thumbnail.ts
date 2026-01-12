/**
 * Generate a thumbnail from a PDF or image file
 * Returns a Blob containing the thumbnail image (PNG format)
 */
export async function generatePdfThumbnail(file: File, maxWidth: number = 400, maxHeight: number = 400): Promise<Blob | null> {
  try {
    // Handle images differently from PDFs
    if (file.type.startsWith('image/')) {
      return generateImageThumbnail(file, maxWidth, maxHeight)
    }
    
    // Handle PDFs
    if (file.type === 'application/pdf') {
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
    }
    
    // If file type is neither PDF nor image, return null
    return null
  } catch (error) {
    console.error('Error generating thumbnail:', error)
    return null
  }
}

/**
 * Generate a thumbnail from an image file
 * Returns a Blob containing the resized thumbnail image (PNG format)
 */
async function generateImageThumbnail(file: File, maxWidth: number = 400, maxHeight: number = 400): Promise<Blob | null> {
  try {
    // Create an image element to load the file
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    
    return new Promise<Blob | null>((resolve) => {
      img.onload = () => {
        // Calculate scale to fit within max dimensions
        const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1.0) // Don't upscale
        const width = img.width * scale
        const height = img.height * scale
        
        // Create canvas
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        
        const context = canvas.getContext('2d')
        if (!context) {
          URL.revokeObjectURL(objectUrl)
          resolve(null)
          return
        }
        
        // Draw image to canvas (resized)
        context.drawImage(img, 0, 0, width, height)
        
        // Convert canvas to blob
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl)
          resolve(blob)
        }, 'image/png', 0.9) // PNG format with 90% quality
      }
      
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        console.error('Error loading image for thumbnail')
        resolve(null)
      }
      
      img.src = objectUrl
    })
  } catch (error) {
    console.error('Error generating image thumbnail:', error)
    return null
  }
}

