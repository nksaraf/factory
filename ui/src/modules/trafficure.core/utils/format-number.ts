/**
 * Format a number using Intl.NumberFormat for localized display
 * @param value - The number to format
 * @param options - Options for formatting (defaults to 1 decimal place)
 * @returns Formatted number string with appropriate decimal places and separators
 */
export function formatNumber(
  value: number | null | undefined,
  options: {
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  } = {}
): string {
  if (value == null || isNaN(value)) {
    return "0"
  }

  const {
    minimumFractionDigits = 1,
    maximumFractionDigits = 1,
  } = options

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}

/**
 * Format a number with no decimal places (for integers)
 */
export function formatInteger(
  value: number | null | undefined
): string {
  return formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/**
 * Format a number with 1 decimal place (most common case)
 */
export function formatDecimal(
  value: number | null | undefined
): string {
  return formatNumber(value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

/**
 * Format delay time: shows seconds if less than 60 seconds, otherwise shows minutes
 * @param delaySec - Delay in seconds
 * @returns Formatted delay string (e.g., "30s" or "5m")
 */
export function formatDelay(delaySec: number | null | undefined): string {
  if (delaySec == null || isNaN(delaySec)) {
    return "0s"
  }
  
  if (delaySec < 60) {
    return `${Math.round(delaySec)}s`
  }
  
  const minutes = delaySec / 60
  return `${formatInteger(minutes)}m`
}

/**
 * Format delay time with "+" prefix for display in UI
 * @param delaySec - Delay in seconds
 * @returns Formatted delay string with "+" prefix (e.g., "+30s" or "+5m")
 */
export function formatDelayWithPrefix(delaySec: number | null | undefined): string {
  const formatted = formatDelay(delaySec)
  return formatted === "0s" ? "0s" : `+${formatted}`
}