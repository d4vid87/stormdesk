// Appliance browsers can report plenty of cores but still have a small renderer/GPU budget.
export function safeMode(userAgent = navigator.userAgent, search = location.search) {
  return new URLSearchParams(search).get('safe') === '1'
    || /Family\s*Hub|Tizen|SMART-TV|Smart\s*Hub|CrOS/i.test(userAgent)
    || (/SamsungBrowser/i.test(userAgent) && !/Android/i.test(userAgent))
    || (typeof navigator !== 'undefined' && navigator.deviceMemory <= 2 && navigator.hardwareConcurrency <= 4);
}
