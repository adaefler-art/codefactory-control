/**
 * Cost Export API
 * 
 * GET /api/v1/costs/export
 * 
 * Exports cost data in CSV or JSON format for controlling and financial analysis.
 * EPIC 9: Cost & Efficiency Engine
 * Issue 9.1: Cost Attribution per Run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCostDataForExport, convertCostDataToCSV } from '@/lib/cost-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get('format') || 'json';
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    // Validate format
    if (!['json', 'csv'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Use "json" or "csv".' },
        { status: 400 }
      );
    }

    // Get cost data
    const costData = await getCostDataForExport(startDate, endDate);

    // Return JSON format
    if (format === 'json') {
      return NextResponse.json({
        api: {
          version: '1.0.0',
          endpoint: '/api/v1/costs/export',
        },
        timestamp: new Date().toISOString(),
        data: costData,
        meta: {
          count: costData.length,
          format: 'json',
          startDate,
          endDate,
        },
      });
    }

    // Return CSV format
    if (format === 'csv') {
      const csv = convertCostDataToCSV(costData);
      
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="factory-costs-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json(
      { error: 'Invalid format' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Cost API - Export] Error:', error);
    return NextResponse.json(
      { error: 'Failed to export cost data' },
      { status: 500 }
    );
  }
}
