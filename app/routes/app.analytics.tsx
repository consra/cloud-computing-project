import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { 
  Card, 
  Page, 
  Layout, 
  Select, 
  BlockStack,
  Text,
  Box,
  InlineStack
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { useState, useCallback } from "react";
import React from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  BarElement,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);
 
type TimeRange = "day" | "week" | "month";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") as TimeRange) || "week";

  const now = new Date();
  let startDate = new Date();

  switch (range) {
    case "day":
      startDate.setDate(now.getDate() - 1);
      break;
    case "month":
      startDate.setMonth(now.getMonth() - 1);
      break;
    default: // week
      startDate.setDate(now.getDate() - 7);
  }

  const [errors, topPaths, totalRedirects, unfixedErrors, topReferrers] = await Promise.all([
    // 404 Errors over time
    prisma.notFoundError.groupBy({
      by: ['timestamp'],
      where: {
        shopDomain: session.shop,
        timestamp: {
          gte: startDate,
          lte: now,
        },
      },
      _count: true,
      orderBy: {
        timestamp: 'asc',
      },
    }),

    // Top Paths
    prisma.notFoundError.groupBy({
      by: ['path'],
      where: {
        shopDomain: session.shop,
        timestamp: {
          gte: startDate,
        },
      },
      _count: true,
      orderBy: [
        {
          path: 'desc'
        }
      ],
      take: 5,
    }),

    // Total Redirects in period
    prisma.redirect.count({
      where: { 
        shopDomain: session.shop,
        createdAt: {
          gte: startDate
        }
      }
    }),

    // Unfixed Errors in period
    prisma.notFoundError.count({
      where: {
        shopDomain: session.shop,
        redirected: false,
        timestamp: {
          gte: startDate
        }
      }
    }),

    // Top Referrers in period
    prisma.notFoundError.groupBy({
      by: ['referer'],
      where: { 
        shopDomain: session.shop,
        timestamp: {
          gte: startDate
        }
      },
      _count: true,
      orderBy: [
        {
          referer: 'desc'
        }
      ],
      take: 3
    })
  ]);

  const totalErrors = errors.reduce((sum, error) => sum + error._count, 0);
  const avgDaily = Math.round(totalErrors / (range === 'day' ? 1 : range === 'week' ? 7 : 30));

  return json({
    errors,
    topPaths,
    range,
    additionalMetrics: {
      totalRedirects,
      totalErrors,
      avgDaily,
      unfixedErrors,
      topReferrers
    }
  });
};

export default function Analytics() {
  const { errors, topPaths, range, additionalMetrics } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [selectedRange, setSelectedRange] = useState(range);

  const handleRangeChange = useCallback((value: string) => {
    setSelectedRange(value as TimeRange);
    navigate(`/app/analytics?range=${value}`);
  }, [navigate]);

  const lineChartData = {
    labels: errors.map(error => 
      new Date(error.timestamp).toLocaleDateString()
    ),
    datasets: [
      {
        label: '404 Errors',
        data: errors.map(error => error._count),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
      },
    ],
  };

  const barChartData = {
    labels: topPaths.map(path => path.path),
    datasets: [
      {
        label: 'Error Count',
        data: topPaths.map(path => path._count),
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
      },
    ],
  };

  return (
    <Page 
      title="404 Analytics Dashboard" 
      subtitle="Monitor and analyze your store's broken links and redirects performance"
      divider
      primaryAction={
        <Box minWidth="200px">
          <Select
            label="Time Range"
            labelInline
            options={[
              { label: 'Last 24 Hours', value: 'day' },
              { label: 'Last 7 Days', value: 'week' },
              { label: 'Last 30 Days', value: 'month' },
            ]}
            onChange={handleRangeChange}
            value={selectedRange}
          />
        </Box>
      }
    >
      <Layout>
        <Layout.Section>

            <Box padding="500">
              <BlockStack gap="500">
                <InlineStack gap="500" wrap={false}>
                  {/* Total 404s Card */}
                  <Box 
                    padding="400" 
                    borderRadius="300"
                    shadow="200"
                    width="100%"
                    background="bg-surface-secondary"
                    borderWidth="025"
                    borderColor="border-critical"
                  >
                    <BlockStack gap="300" align="center">
                      <Text variant="headingSm" as="h3">Total 404s</Text>
                      <div style={{ 
                        backgroundColor: 'var(--p-color-bg-critical-subdued)',
                        padding: '16px',
                        borderRadius: '12px',
                        width: '100%',
                        textAlign: 'center'
                      }}>
                        <Text variant="heading2xl" as="p" fontWeight="bold">
                          {additionalMetrics.totalErrors}
                        </Text>
                      </div>
                      <Text variant="bodySm" tone="subdued">
                        Total broken links in selected period
                      </Text>
                    </BlockStack>
                  </Box>

                  {/* Active Redirects Card */}
                  <Box 
                    padding="400" 
                    borderRadius="300"
                    shadow="200"
                    width="100%"
                    background="bg-surface-secondary"
                    borderWidth="025"
                    borderColor="border-info"
                  >
                    <BlockStack gap="300" align="center">
                      <Text variant="headingSm" as="h3">Active Simple Redirects</Text>
                      <div style={{ 
                        backgroundColor: 'var(--p-color-bg-info-subdued)',
                        padding: '16px',
                        borderRadius: '12px',
                        width: '100%',
                        textAlign: 'center'
                      }}>
                        <Text variant="heading2xl" as="p" fontWeight="bold">
                          {additionalMetrics.totalRedirects}
                        </Text>
                      </div>
                      <Text variant="bodySm" tone="subdued">
                        Redirects added in the selected period
                      </Text>
                    </BlockStack>
                  </Box>

                  {/* Top Sources Card */}
                  <Box 
                    padding="400" 
                    borderRadius="300"
                    shadow="200"
                    width="100%"
                    background="bg-surface-secondary"
                    borderWidth="025"
                    borderColor="border-warning"
                  >
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3" alignment="center">Top Sources</Text>
                      <BlockStack gap="200">
                        {additionalMetrics.topReferrers.map((ref, index) => (
                          <Box
                            key={ref.referer || 'direct'}
                            background="bg-surface"
                            padding="300"
                            borderRadius="200"
                            shadow="100"
                          >
                            <InlineStack align="space-between">
                              <Text variant="bodyMd" fontWeight="medium">
                                {ref.referer || 'Direct'}
                              </Text>
                              <Text variant="bodyMd" tone="subdued">
                                {ref._count}
                              </Text>
                            </InlineStack>
                          </Box>
                        ))}
                      </BlockStack>
                    </BlockStack>
                  </Box>
                </InlineStack>
              </BlockStack>
            </Box>
        </Layout.Section>

        {/* Time Series Chart */}
        <Layout.Section>
          <Card>
            <Box padding="500">
              <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <InlineStack gap="200" align="left">
                      <Text variant="headingMd" as="h2">404 Errors Over Time</Text>
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued">
                      Track and analyze error patterns over different time periods
                    </Text>
                  </BlockStack>
                </InlineStack>
                
                <Box 
                  background="bg-surface-secondary" 
                  padding="600" 
                  borderRadius="300"
                  borderWidth="025"
                  borderColor="border-subdued"
                  shadow="100"
                >
                  <div style={{ height: '350px' }}>
                    <Line 
                      data={{
                        ...lineChartData,
                        datasets: [{
                          ...lineChartData.datasets[0],
                          borderColor: 'var(--p-color-text-success)',
                          backgroundColor: 'var(--p-color-bg-success-subdued)',
                          fill: true,
                          borderWidth: 2,
                        }]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: {
                            display: false
                          }
                        },
                        scales: {
                          y: {
                            beginAtZero: true,
                            ticks: {
                              precision: 0
                            },
                            grid: {
                              color: 'var(--p-color-border-subdued)'
                            }
                          },
                          x: {
                            grid: {
                              color: 'var(--p-color-border-subdued)'
                            }
                          }
                        }
                      }}
                    />
                  </div>
                </Box>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* Top Paths Chart */}
        <Layout.Section>
          <Card>
            <Box padding="500">
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Text variant="headingMd" as="h2">Most Common 404 Paths</Text>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued">
                    Identify frequently occurring broken links
                  </Text>
                </BlockStack>
                
                <Box 
                  background="bg-surface-secondary" 
                  padding="600" 
                  borderRadius="300"
                  borderWidth="025"
                  borderColor="border-subdued"
                  shadow="100"
                >
                  <div style={{ height: '350px' }}>
                    <Bar 
                      data={{
                        ...barChartData,
                        datasets: [{
                          ...barChartData.datasets[0],
                          backgroundColor: 'var(--p-color-bg-info)',
                          borderRadius: 6,
                        }]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'y' as const,
                        plugins: {
                          legend: {
                            display: false
                          }
                        },
                        scales: {
                          x: {
                            beginAtZero: true,
                            ticks: {
                              precision: 0
                            },
                            grid: {
                              color: 'var(--p-color-border-subdued)'
                            }
                          },
                          y: {
                            grid: {
                              display: false
                            }
                          }
                        }
                      }}
                    />
                  </div>
                </Box>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
} 