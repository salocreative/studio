/**
 * Helper functions for Monday.com API requests
 */

const MONDAY_API_URL = 'https://api.monday.com/v2'

interface MondayApiResponse<T> {
  data: T
  errors?: Array<{ message: string }>
}

/**
 * Make a GraphQL request to Monday.com API
 */
export async function mondayRequest<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  })

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.statusText}`)
  }

  const result: MondayApiResponse<T> = await response.json()

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Monday.com API errors: ${result.errors.map((e) => e.message).join(', ')}`)
  }

  return result.data
}

