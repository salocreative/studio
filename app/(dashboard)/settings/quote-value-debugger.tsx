'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { debugQuoteValueMapping } from '@/app/actions/debug-quote-value'
import { backfillQuoteValue } from '@/app/actions/backfill-quote-value'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

export function QuoteValueDebugger() {
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [results, setResults] = useState<any>(null)

  async function runDebug() {
    setLoading(true)
    try {
      const result = await debugQuoteValueMapping()
      if (result.error) {
        toast.error('Error running debug', { description: result.error })
        setResults(null)
      } else {
        setResults(result)
        toast.success('Debug completed')
      }
    } catch (error) {
      toast.error('Error running debug', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            This will check your quote_value column mappings and test value extraction on sample projects.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={runDebug} disabled={loading || backfilling} variant="outline">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              'Run Debug'
            )}
          </Button>
          <Button 
            onClick={async () => {
              setBackfilling(true)
              try {
                const result = await backfillQuoteValue()
                if (result.error) {
                  toast.error('Error backfilling', { description: result.error })
                } else {
                  toast.success(result.message || 'Backfill completed')
                  // Refresh debug results
                  await runDebug()
                }
              } catch (error) {
                toast.error('Error backfilling', {
                  description: error instanceof Error ? error.message : 'Unknown error',
                })
              } finally {
                setBackfilling(false)
              }
            }}
            disabled={loading || backfilling}
          >
            {backfilling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Backfilling...
              </>
            ) : (
              'Backfill from monday_data'
            )}
          </Button>
        </div>
      </div>

      {results && (
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Mappings</p>
                  <p className="text-2xl font-bold">{results.summary.totalMappings}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Board Specific</p>
                  <p className="text-2xl font-bold">{results.summary.boardSpecificMappings}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Global</p>
                  <p className="text-2xl font-bold">{results.summary.globalMappings}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Projects with Mapping</p>
                  <p className="text-2xl font-bold">{results.summary.projectsWithMapping}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Values Extracted</p>
                  <p className="text-2xl font-bold">{results.summary.projectsWithExtractedValue}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mappings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Column Mappings</CardTitle>
            </CardHeader>
            <CardContent>
              {results.mappings.length === 0 ? (
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertCircle className="h-5 w-5" />
                  <p>No quote_value column mappings found. Please configure them in the Column Mappings section above.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {results.mappings.map((mapping: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="font-medium">Column ID: {mapping.monday_column_id}</p>
                        <p className="text-sm text-muted-foreground">
                          {mapping.board_id ? `Board-specific (${mapping.board_id})` : 'Global mapping'}
                        </p>
                      </div>
                      <Badge variant={mapping.board_id ? 'default' : 'secondary'}>
                        {mapping.board_id ? 'Board' : 'Global'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Project Analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sample Projects Analysis</CardTitle>
              <CardDescription>Checking {results.projectAnalysis.length} sample projects</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {results.projectAnalysis.map((project: any, idx: number) => (
                  <div key={idx} className="space-y-2 p-4 rounded-lg border">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground">Board ID: {project.boardId}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {project.currentQuoteValue ? (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Has Value: {project.currentQuoteValue}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">No Value</Badge>
                        )}
                      </div>
                    </div>

                    {/* Mapping Info */}
                    <div className="space-y-1">
                      <p className="text-xs font-semibold">Mapping:</p>
                      {project.mapping.used ? (
                        <div className="text-xs bg-muted p-2 rounded">
                          <p>Using: {project.mapping.boardSpecific ? 'Board-specific' : 'Global'} mapping</p>
                          <p>Column ID: {project.mapping.used.monday_column_id}</p>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          No mapping found for this board
                        </div>
                      )}
                    </div>

                    {/* Extraction Info */}
                    {project.extraction && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold">Value Extraction:</p>
                        <div className="text-xs bg-muted p-2 rounded space-y-1">
                          <p>Column ID in monday_data: {project.extraction.columnId}</p>
                          {project.extraction.columnData ? (
                            <>
                              <p>Column Type: {project.extraction.columnData.type}</p>
                              <p>Text: {project.extraction.columnData.text || '(empty)'}</p>
                              <p>Value Type: {project.extraction.columnData.valueType}</p>
                              <p>Value: {JSON.stringify(project.extraction.columnData.value)}</p>
                              {project.extraction.parsedValue !== null ? (
                                <div className="flex items-center gap-1 text-green-600">
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>Parsed Value: {project.extraction.parsedValue}</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-amber-600">
                                  <AlertCircle className="h-3 w-3" />
                                  <span>Could not parse value</span>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-amber-600">Column not found in monday_data</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

