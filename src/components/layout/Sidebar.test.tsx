/**
 * Component tests for the Sidebar.
 * Total: 2 tests
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAppStore } from '@/stores/app-store'
import { act } from 'react'

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar />
    </MemoryRouter>
  )
}

describe('Sidebar', () => {
  it('renders all main navigation links', () => {
    renderSidebar()

    // All nav items should be visible
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Test Runner')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('collapses when the toggle button is clicked', async () => {
    // Ensure sidebar starts expanded
    act(() => { useAppStore.getState().setSidebarCollapsed(false) })

    renderSidebar()

    // Dashboard text visible initially (not collapsed)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()

    // Click the chevron toggle button
    const toggleBtn = screen.getByRole('button')
    await userEvent.click(toggleBtn)

    // After collapse, text labels are hidden (sidebar shows only icons)
    const state = useAppStore.getState()
    expect(state.sidebarCollapsed).toBe(true)
  })
})
