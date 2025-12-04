'use client'

import { PieChart, Pie, Cell, Tooltip } from 'recharts'

interface DoughnutChartProps {
  data: {
    name: string
    value: number
    color: string
  }[]
  size?: number
  innerRadius?: number
  outerRadius?: number
  showPercentage?: boolean
  percentageColor?: string
}

export function DoughnutChart({ 
  data, 
  size = 120, 
  innerRadius = 40, 
  outerRadius = 50,
  showPercentage = true,
  percentageColor
}: DoughnutChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  // Calculate percentage based on first segment vs total
  // For over-budget: we want to show logged/quoted percentage
  const percentage = total > 0 ? ((data[0]?.value / total) * 100) : 0
  
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie
          data={data}
          cx={size / 2}
          cy={size / 2}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          dataKey="value"
          startAngle={90}
          endAngle={-270}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => [`${value.toFixed(1)}h`, '']}
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            padding: '8px',
          }}
        />
      </PieChart>
      {showPercentage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div 
              className="text-2xl font-bold"
              style={percentageColor ? { color: percentageColor } : undefined}
            >
              {percentage.toFixed(0)}%
            </div>
            <div className="text-xs text-muted-foreground">used</div>
          </div>
        </div>
      )}
    </div>
  )
}

