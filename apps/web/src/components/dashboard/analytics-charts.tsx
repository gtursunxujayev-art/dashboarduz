'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Mock data - in a real app, this would come from the API
const leadStatusData = [
  { name: 'New', value: 12, color: '#3B82F6' },
  { name: 'Contacted', value: 8, color: '#F59E0B' },
  { name: 'Qualified', value: 15, color: '#10B981' },
  { name: 'Lost', value: 5, color: '#EF4444' },
];

const monthlyLeadsData = [
  { month: 'Jan', leads: 40 },
  { month: 'Feb', leads: 30 },
  { month: 'Mar', leads: 45 },
  { month: 'Apr', leads: 35 },
  { month: 'May', leads: 50 },
  { month: 'Jun', leads: 55 },
];

const callMetricsData = [
  { name: 'Total Calls', value: 124 },
  { name: 'Answered', value: 89 },
  { name: 'Missed', value: 35 },
  { name: 'Avg Duration', value: '4.2m' },
];

const integrationActivityData = [
  { name: 'AmoCRM', syncs: 45, errors: 2 },
  { name: 'Telegram', messages: 128, errors: 0 },
  { name: 'Google Sheets', exports: 12, errors: 1 },
  { name: 'VoIP', calls: 124, errors: 3 },
];

export default function AnalyticsCharts() {
  const [timeRange, setTimeRange] = useState('month');

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-md shadow-sm">
          {['day', 'week', 'month', 'quarter'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 text-sm font-medium ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              } border border-gray-300 ${
                range === 'day' ? 'rounded-l-md' : ''
              } ${
                range === 'quarter' ? 'rounded-r-md' : ''
              } ${range !== 'day' && range !== 'quarter' ? 'border-l-0' : ''}`}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Status Distribution */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Lead Status Distribution</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={leadStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {leadStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${value} leads`, 'Count']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Leads Trend */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Monthly Leads Trend</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyLeadsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip
                  formatter={(value) => [`${value} leads`, 'Count']}
                  labelFormatter={(label) => `Month: ${label}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="leads"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ stroke: '#3B82F6', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Call Metrics */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Call Metrics</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={callMetricsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip />
                <Bar dataKey="value" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Integration Activity */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Integration Activity</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={integrationActivityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip />
                <Legend />
                <Bar dataKey="syncs" name="Successful Syncs" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="errors" name="Errors" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-blue-100 rounded-md p-2">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-blue-900">Total Leads</p>
              <p className="text-2xl font-semibold text-blue-700">80</p>
            </div>
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-green-100 rounded-md p-2">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-green-900">Conversion Rate</p>
              <p className="text-2xl font-semibold text-green-700">18.75%</p>
            </div>
          </div>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-purple-100 rounded-md p-2">
              <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-purple-900">Avg Call Duration</p>
              <p className="text-2xl font-semibold text-purple-700">4.2m</p>
            </div>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-yellow-100 rounded-md p-2">
              <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-yellow-900">Response Time</p>
              <p className="text-2xl font-semibold text-yellow-700">2.1h</p>
            </div>
          </div>
        </div>
      </div>

      {/* Data Last Updated */}
      <div className="text-xs text-gray-500 text-center">
        <p>Data updated: {new Date().toLocaleString()}</p>
        <p className="mt-1">Charts refresh automatically every 5 minutes</p>
      </div>
    </div>
  );
}
