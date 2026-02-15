const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Set viewport size
  await page.setViewportSize({ width: 1920, height: 1080 });
  
  console.log('\n=== TESTING ALL MISSION CONTROL VIEWS ===\n');
  
  // 1. Dashboard
  console.log('1. DASHBOARD (/)');
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const dashboardText = await page.textContent('body');
  const hasAgents = dashboardText.includes('main') || dashboardText.includes('gilfoyle');
  const hasSessions = dashboardText.includes('session') || dashboardText.includes('Session');
  const hasCron = dashboardText.includes('cron') || dashboardText.includes('Cron');
  const hasDevices = dashboardText.includes('device') || dashboardText.includes('Device');
  const hasSkills = dashboardText.includes('skill') || dashboardText.includes('Skill');
  
  console.log(`  - Agents mentioned: ${hasAgents ? '✅' : '❌'}`);
  console.log(`  - Sessions mentioned: ${hasSessions ? '✅' : '❌'}`);
  console.log(`  - Cron jobs mentioned: ${hasCron ? '✅' : '❌'}`);
  console.log(`  - Devices mentioned: ${hasDevices ? '✅' : '❌'}`);
  console.log(`  - Skills mentioned: ${hasSkills ? '✅' : '❌'}`);
  
  await page.screenshot({ path: 'test-1-dashboard.png', fullPage: true });
  console.log('  Screenshot: test-1-dashboard.png\n');
  
  // 2. Tasks
  console.log('2. TASKS (?section=tasks)');
  await page.goto('http://127.0.0.1:3000/?section=tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const tasksText = await page.textContent('body');
  const hasRestock = tasksText.includes('Restock Versa EVOO');
  const hasPricing = tasksText.includes('B2B pricing');
  const hasMetaAds = tasksText.includes('Meta ads');
  const hasPackShip = tasksText.includes('Pack and ship');
  
  console.log(`  - "Restock Versa EVOO inventory": ${hasRestock ? '✅' : '❌'}`);
  console.log(`  - "Update B2B pricing sheet": ${hasPricing ? '✅' : '❌'}`);
  console.log(`  - "Set up Meta ads campaign": ${hasMetaAds ? '✅' : '❌'}`);
  console.log(`  - "Pack and ship orders": ${hasPackShip ? '✅' : '❌'}`);
  
  await page.screenshot({ path: 'test-2-tasks.png', fullPage: true });
  console.log('  Screenshot: test-2-tasks.png\n');
  
  // 3. Cron Jobs
  console.log('3. CRON JOBS (?section=cron)');
  await page.goto('http://127.0.0.1:3000/?section=cron', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const cronText = await page.textContent('body');
  const hasCEOBrief = cronText.includes('Daily CEO Brief') || cronText.includes('CEO Brief');
  const hasSystemHealth = cronText.includes('System Health');
  const hasBrowser = cronText.includes('Keep Browser Running') || cronText.includes('Browser Running');
  const hasMorningBrief = cronText.includes('Morning Brief');
  
  console.log(`  - "Daily CEO Brief - Versa": ${hasCEOBrief ? '✅' : '❌'}`);
  console.log(`  - "System Health & Maintenance Check": ${hasSystemHealth ? '✅' : '❌'}`);
  console.log(`  - "Keep Browser Running": ${hasBrowser ? '✅' : '❌'}`);
  console.log(`  - "Morning Brief": ${hasMorningBrief ? '✅' : '❌'}`);
  
  await page.screenshot({ path: 'test-3-cron.png', fullPage: true });
  console.log('  Screenshot: test-3-cron.png');
  
  // Try to click on a cron job
  const cronButtons = await page.$$('button[type="button"]');
  if (cronButtons.length > 0) {
    console.log('  Clicking on first cron job...');
    await cronButtons[0].click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-3b-cron-detail.png', fullPage: true });
    console.log('  Screenshot: test-3b-cron-detail.png\n');
  } else {
    console.log('  No cron job buttons found\n');
  }
  
  // 4. Sessions
  console.log('4. SESSIONS (?section=sessions)');
  await page.goto('http://127.0.0.1:3000/?section=sessions', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const sessionsText = await page.textContent('body');
  const hasSessionData = sessionsText.includes('session') || sessionsText.includes('Session') || 
                         sessionsText.includes('agent') || sessionsText.includes('Agent');
  console.log(`  - Session data present: ${hasSessionData ? '✅' : '❌'}`);
  
  await page.screenshot({ path: 'test-4-sessions.png', fullPage: true });
  console.log('  Screenshot: test-4-sessions.png\n');
  
  // 5. System
  console.log('5. SYSTEM (?section=system)');
  await page.goto('http://127.0.0.1:3000/?section=system', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const systemText = await page.textContent('body');
  const hasTelegram = systemText.includes('Telegram');
  const has6Devices = systemText.includes('6') && systemText.includes('device');
  const has55Skills = systemText.includes('55') && systemText.includes('skill');
  
  console.log(`  - Telegram channel: ${hasTelegram ? '✅' : '❌'}`);
  console.log(`  - 6 paired devices: ${has6Devices ? '✅' : '❌'}`);
  console.log(`  - 55 total skills: ${has55Skills ? '✅' : '❌'}`);
  
  await page.screenshot({ path: 'test-5-system.png', fullPage: true });
  console.log('  Screenshot: test-5-system.png\n');
  
  // 6. Memory
  console.log('6. MEMORY (?section=memory)');
  await page.goto('http://127.0.0.1:3000/?section=memory', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'test-6-memory.png', fullPage: true });
  console.log('  Screenshot: test-6-memory.png\n');
  
  // 7. Docs
  console.log('7. DOCS (?section=docs)');
  await page.goto('http://127.0.0.1:3000/?section=docs', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'test-7-docs.png', fullPage: true });
  console.log('  Screenshot: test-7-docs.png\n');
  
  // Check sidebar navigation
  console.log('8. SIDEBAR NAVIGATION CHECK');
  const sidebarText = await page.textContent('aside');
  const navItems = [
    'Dashboard',
    'Tasks', 
    'Cron Jobs',
    'Sessions',
    'System',
    'Memory',
    'Docs'
  ];
  
  console.log('  Sidebar items:');
  for (const item of navItems) {
    const hasItem = sidebarText.includes(item);
    console.log(`    - ${item}: ${hasItem ? '✅' : '❌'}`);
  }
  
  console.log('\n=== TESTING COMPLETE ===\n');
  
  await browser.close();
})();
