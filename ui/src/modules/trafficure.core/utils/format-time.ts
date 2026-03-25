/**
 * Format an ISO date string to time only (HH:MM AM/PM format) or with date if not today
 * @param isoString - ISO date string (e.g., "2026-01-22T19:16:21.015935+05:30")
 * @param referenceDate - Optional reference date to check if we should show date (for consistency)
 * @returns Formatted time string (e.g., "7:16 PM" or "Jan 22, 7:16 PM")
 */
export function formatTime(
  isoString: string | null | undefined,
  referenceDate?: string | null
): string {
  if (!isoString) {
    return "N/A"
  }

  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) {
      return "N/A"
    }

    const now = new Date()
    
    // If referenceDate is provided, use it to determine if we should show date
    // This ensures consistency: if start time shows date, end time should too
    let shouldShowDate = false
    if (referenceDate) {
      const refDate = new Date(referenceDate)
      const isRefToday =
        refDate.getDate() === now.getDate() &&
        refDate.getMonth() === now.getMonth() &&
        refDate.getFullYear() === now.getFullYear()
      shouldShowDate = !isRefToday
    } else {
      // Default behavior: check if this date is today
      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      shouldShowDate = !isToday
    }

    // Format as 12-hour time with AM/PM
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? "PM" : "AM"
    const displayHours = hours % 12 || 12
    const displayMinutes = minutes.toString().padStart(2, "0")
    const timeString = `${displayHours}:${displayMinutes} ${ampm}`

    if (!shouldShowDate) {
      return timeString
    } else {
      // Format date as "Jan 22"
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ]
      const month = monthNames[date.getMonth()]
      const day = date.getDate()
      return `${month} ${day}, ${timeString}`
    }
  } catch (error) {
    console.error("Error formatting time:", error)
    return "N/A"
  }
}

/**
 * Format an ISO date string to always include date (for header display)
 * @param isoString - ISO date string (e.g., "2026-01-22T19:16:21.015935+05:30")
 * @returns Formatted string with date and time (e.g., "Jan 22, 7:16 PM")
 */
export function formatTimeWithDate(isoString: string | null | undefined): string {
  if (!isoString) {
    return "N/A"
  }

  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) {
      return "N/A"
    }

    // Format as 12-hour time with AM/PM
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? "PM" : "AM"
    const displayHours = hours % 12 || 12
    const displayMinutes = minutes.toString().padStart(2, "0")
    const timeString = `${displayHours}:${displayMinutes} ${ampm}`

    // Always include date
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]
    const month = monthNames[date.getMonth()]
    const day = date.getDate()
    return `${month} ${day}, ${timeString}`
  } catch (error) {
    console.error("Error formatting time:", error)
    return "N/A"
  }
}

/**
 * Format an ISO date string with smart date labels: "Today", "Yesterday", or date + time
 * @param isoString - ISO date string (e.g., "2026-01-22T19:16:21.015935+05:30")
 * @returns Formatted string (e.g., "Today 7:16 PM", "Yesterday 7:16 PM", or "Jan 22, 7:16 PM")
 */
export function formatTimeWithSmartDate(isoString: string | null | undefined): string {
  if (!isoString) {
    return "N/A"
  }

  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) {
      return "N/A"
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    // Format as 12-hour time with AM/PM
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? "PM" : "AM"
    const displayHours = hours % 12 || 12
    const displayMinutes = minutes.toString().padStart(2, "0")
    const timeString = `${displayHours}:${displayMinutes} ${ampm}`

    // Check if it's today
    if (dateOnly.getTime() === today.getTime()) {
      return `Today ${timeString}`
    }

    // Check if it's yesterday
    if (dateOnly.getTime() === yesterday.getTime()) {
      return `Yesterday ${timeString}`
    }

    // For other dates, show date + time
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]
    const month = monthNames[date.getMonth()]
    const day = date.getDate()
    return `${month} ${day}, ${timeString}`
  } catch (error) {
    console.error("Error formatting time:", error)
    return "N/A"
  }
}

/**
 * Format a time range, showing date only once if both times are on the same day
 * @param startTime - ISO date string for start time
 * @param endTime - ISO date string for end time (can be null for ongoing alerts)
 * @returns Formatted string (e.g., "Today 10:00 AM → 11:30 AM" or "Today 10:00 AM → Yesterday 11:30 AM")
 */
export function formatTimeRange(startTime: string | null | undefined, endTime: string | null | undefined): string {
  if (!startTime) {
    return "N/A"
  }

  try {
    const startDate = new Date(startTime)
    if (isNaN(startDate.getTime())) {
      return "N/A"
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())

    // Format start time with date prefix
    const startFormatted = formatTimeWithSmartDate(startTime)

    // If no end time (ongoing alert), just return start time
    if (!endTime) {
      return startFormatted
    }

    const endDate = new Date(endTime)
    if (isNaN(endDate.getTime())) {
      return startFormatted
    }

    const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())

    // Check if both dates are on the same day
    const isSameDay = startDateOnly.getTime() === endDateOnly.getTime()

    if (isSameDay) {
      // Same day: only show time for end (no date prefix)
      const hours = endDate.getHours()
      const minutes = endDate.getMinutes()
      const ampm = hours >= 12 ? "PM" : "AM"
      const displayHours = hours % 12 || 12
      const displayMinutes = minutes.toString().padStart(2, "0")
      const endTimeString = `${displayHours}:${displayMinutes} ${ampm}`

      // Extract the date prefix from start (e.g., "Today", "Yesterday", or "Jan 22,")
      // and combine with end time
      const startParts = startFormatted.split(" ")
      if (startParts.length >= 3) {
        // Has date prefix (e.g., "Today 10:00 AM" or "Jan 22, 10:00 AM")
        const datePrefix = startParts.slice(0, -2).join(" ") // "Today" or "Jan 22,"
        const startTimeOnly = startParts.slice(-2).join(" ") // "10:00 AM"
        return `${datePrefix} ${startTimeOnly} → ${endTimeString}`
      } else {
        // No date prefix (shouldn't happen with formatTimeWithSmartDate, but handle it)
        return `${startFormatted} → ${endTimeString}`
      }
    } else {
      // Different days: show full date for both
      return `${startFormatted} → ${formatTimeWithSmartDate(endTime)}`
    }
  } catch (error) {
    console.error("Error formatting time range:", error)
    return formatTimeWithSmartDate(startTime)
  }
}

