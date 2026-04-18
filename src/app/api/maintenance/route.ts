import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const settings = await db.settings.findUnique({
      where: { id: 'main' },
      select: {
        maintenanceMode: true,
        maintenanceMessage: true
      }
    })

    return NextResponse.json({
      maintenance: settings?.maintenanceMode ?? false,
      message: settings?.maintenanceMessage ?? null
    })
  } catch (error) {
    console.error('Error fetching maintenance status:', error)
    return NextResponse.json({
      maintenance: false,
      message: null
    })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { maintenanceMode, maintenanceMessage, userId } = body

    // Verify user is admin
    if (userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { role: true }
      })

      if (!user || user.role !== 'Admin') {
        return NextResponse.json(
          { error: 'Hanya Admin yang dapat mengubah status maintenance' },
          { status: 403 }
        )
      }
    } else {
      return NextResponse.json(
        { error: 'User ID diperlukan' },
        { status: 400 }
      )
    }

    const updateData: { maintenanceMode: boolean; maintenanceMessage?: string | null } = {
      maintenanceMode: maintenanceMode ?? false
    }

    if (maintenanceMessage !== undefined) {
      updateData.maintenanceMessage = maintenanceMessage || null
    }

    const settings = await db.settings.upsert({
      where: { id: 'main' },
      update: updateData,
      create: {
        id: 'main',
        maintenanceMode: updateData.maintenanceMode,
        maintenanceMessage: updateData.maintenanceMessage ?? null
      }
    })

    return NextResponse.json({
      success: true,
      maintenance: settings.maintenanceMode,
      message: settings.maintenanceMessage
    })
  } catch (error) {
    console.error('Error updating maintenance status:', error)
    return NextResponse.json(
      { error: 'Gagal mengubah status maintenance' },
      { status: 500 }
    )
  }
}
