/**
 * Date utility functions for converting dates to IST timezone
 */

/**
 * Converts a Date object to ISO string in IST timezone
 * @param date - The date to convert
 * @returns ISO string in IST timezone (e.g., "2026-02-18T20:15:30.000+05:30")
 */
export function toISTISOString(date: Date = new Date()): string {
  // Get the date in IST timezone
  const istOffset = 5.5 * 60 * 60 * 1000 // IST is UTC+5:30
  const istTime = new Date(date.getTime() + istOffset)
  
  // Format as ISO string with IST offset
  const year = istTime.getUTCFullYear()
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0')
  const day = String(istTime.getUTCDate()).padStart(2, '0')
  const hours = String(istTime.getUTCHours()).padStart(2, '0')
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0')
  const seconds = String(istTime.getUTCSeconds()).padStart(2, '0')
  const milliseconds = String(istTime.getUTCMilliseconds()).padStart(3, '0')
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+05:30`
}

/**
 * Gets the current date/time in IST as ISO string
 * @returns Current time in IST ISO format
 */
export function getCurrentISTISOString(): string {
  return toISTISOString(new Date())
}

/**
 * Gets a date N days ago in IST as ISO string
 * @param days - Number of days to go back
 * @returns Date N days ago in IST ISO format
 */
export function getISTISOStringDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return toISTISOString(date)
}

