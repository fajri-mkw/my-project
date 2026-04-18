import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get all projects for public tracker with time filter
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const timeFilter = searchParams.get('filter') || 'all'
    
    // Calculate date range based on filter
    const now = new Date()
    let dateFilter: Date | null = null
    
    switch (timeFilter) {
      case 'day':
        dateFilter = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'week':
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        dateFilter = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'year':
        dateFilter = new Date(now.getFullYear(), 0, 1)
        break
      default:
        dateFilter = null
    }
    
    // Build where clause
    const whereClause = dateFilter 
      ? { createdAt: { gte: dateFilter } }
      : {}
    
    const projects = await db.project.findMany({
      where: whereClause,
      include: {
        tasks: {
          include: {
            assignee: {
              select: { id: true, name: true, avatar: true, role: true }
            }
          }
        },
        manager: {
          select: { id: true, name: true, avatar: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    // Calculate statistics
    const totalProjects = projects.length
    const completedProjects = projects.filter(p => p.currentStage === 5).length
    const activeProjects = totalProjects - completedProjects
    
    return NextResponse.json({ 
      projects,
      stats: {
        total: totalProjects,
        completed: completedProjects,
        active: activeProjects
      },
      filter: timeFilter,
      lastUpdated: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error fetching public tracker:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
