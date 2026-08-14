import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, parseISO } from 'date-fns';
import { useQualityTrend, type ReviewSource } from '@/hooks/useDashboard';

const timeRanges = [
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
];

export const QualityTrend = ({ source = 'all' }: { source?: ReviewSource }) => {
  const [selectedRange, setSelectedRange] = useState(30);
  const { data: trendData, isLoading, error } = useQualityTrend(selectedRange, source);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-none dark:border-border dark:bg-card">
        <div className="h-80 animate-pulse rounded-lg bg-secondary dark:bg-secondary" />
      </div>
    );
  }

  if (error || !trendData) {
    return (
      <div className="rounded-xl border border-error-200 bg-error-50 p-6 dark:border-error-800 dark:bg-error-900/20">
        <p className="text-sm text-error-600 dark:text-error-400">
          Failed to load quality trend data. Please try again.
        </p>
      </div>
    );
  }

  const chartData = trendData?.map((item) => ({
    date: format(parseISO(item?.date || new Date().toISOString()), 'MMM dd'),
    score: item?.score ?? 0,
    reviews: item?.reviewCount ?? 0,
  })) || [];

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-none dark:border-border dark:bg-card">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground dark:text-primary-foreground">Quality Trend</h3>
          <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">
            Average code quality score over time
          </p>
        </div>
        <div className="flex gap-2">
          {timeRanges.map((range) => (
            <button
              key={range.value}
              onClick={() => setSelectedRange(range.value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                selectedRange === range.value
                  ? 'bg-brand-500 text-primary-foreground'
                  : 'bg-secondary text-foreground hover:bg-gray-200 dark:bg-secondary dark:text-muted-foreground dark:hover:bg-gray-700'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2A2F3A" />
          <XAxis
            dataKey="date"
            stroke="#8B92A3"
            className="dark:stroke-gray-500"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            yAxisId="left"
            stroke="#8B92A3"
            className="dark:stroke-gray-500"
            tick={{ fontSize: 12 }}
            domain={[0, 100]}
            label={{ value: 'Quality Score', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#8B92A3"
            className="dark:stroke-gray-500"
            tick={{ fontSize: 12 }}
            label={{ value: 'Review Count', angle: 90, position: 'insideRight', fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1A1E27',
              border: '1px solid #2A2F3A',
              color: '#E7E9F0',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="score"
            stroke="#5EEAD4"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
            name="Quality Score"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="reviews"
            stroke="#FFB454"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
            name="Review Count"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
