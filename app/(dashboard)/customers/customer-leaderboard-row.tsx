'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { type Customer } from '@/app/actions/customers'
import { useState, useEffect } from 'react'
import { getUserRelationshipVote, getCustomerRelationshipVotes } from '@/app/actions/customers'
import { Loader2 } from 'lucide-react'

interface CustomerLeaderboardRowProps {
  customer: Customer
  rank: number
  onVote: () => void
}

export default function CustomerLeaderboardRow({ customer, rank, onVote }: CustomerLeaderboardRowProps) {
  const [userVote, setUserVote] = useState<number | null>(null)
  const [allVotes, setAllVotes] = useState<Array<{ user_name: string; relationship_score: number }>>([])
  const [loadingVotes, setLoadingVotes] = useState(false)

  useEffect(() => {
    loadVotes()
  }, [customer.client_name])

  async function loadVotes() {
    setLoadingVotes(true)
    try {
      const [userVoteResult, allVotesResult] = await Promise.all([
        getUserRelationshipVote(customer.client_name),
        getCustomerRelationshipVotes(customer.client_name),
      ])

      if (!userVoteResult.error) {
        setUserVote(userVoteResult.score ?? null)
      }
      if (!allVotesResult.error && allVotesResult.votes) {
        setAllVotes(allVotesResult.votes)
      }
    } catch (error) {
      console.error('Error loading votes:', error)
    } finally {
      setLoadingVotes(false)
    }
  }

  const averageScore = customer.relationship_score || 0
  const hasVotes = allVotes.length > 0

  return (
    <div className="flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex-shrink-0 w-8 text-center font-semibold text-muted-foreground">
        #{rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{customer.client_name}</div>
        <div className="text-sm text-muted-foreground">
          £{customer.lifetime_value.toLocaleString()} • {customer.project_count} project{customer.project_count !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* User's vote */}
        <div className="text-right">
          <div className="text-xs text-muted-foreground mb-1">Your Vote</div>
          <div className="font-semibold">
            {userVote !== null ? (
              <Badge variant={userVote >= 7 ? 'default' : userVote >= 5 ? 'secondary' : 'destructive'}>
                {userVote}/10
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">Not voted</span>
            )}
          </div>
        </div>
        {/* Average score */}
        <div className="text-right">
          <div className="text-xs text-muted-foreground mb-1">Average</div>
          <div className="font-semibold">
            {hasVotes ? (
              <Badge variant={averageScore >= 7 ? 'default' : averageScore >= 5 ? 'secondary' : 'destructive'}>
                {averageScore.toFixed(1)}/10
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">No votes</span>
            )}
          </div>
        </div>
        {/* Vote button */}
        <Button variant="outline" size="sm" onClick={onVote}>
          {userVote !== null ? 'Update Vote' : 'Vote'}
        </Button>
      </div>
    </div>
  )
}

