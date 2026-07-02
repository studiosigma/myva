import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppApiService } from '../../integrations/whatsapp-api.service';
import { AIService } from '../ai/ai.service';
import { ExpenseService } from '../expense/expense.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class BriefingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappApiService: WhatsAppApiService,
    private readonly aiService: AIService,
    private readonly expenseService: ExpenseService,
    @InjectQueue('email_queue') private readonly emailQueue: Queue,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Daily Briefing, Follow Up, Deadline Alert & Weekly Expense Report Scheduler initialized. Checking intervals every 60 seconds.');
    // Run interval check every 60 seconds
    setInterval(() => {
      this.checkAndSendBriefings().catch(err => {
        this.logger.error(`Error checking daily briefings: ${err.message}`);
      });
      this.checkAndSendFollowUps().catch(err => {
        this.logger.error(`Error checking smart follow ups: ${err.message}`);
      });
      this.checkAndSendDeadlineAlerts().catch(err => {
        this.logger.error(`Error checking deadline alerts: ${err.message}`);
      });
      this.checkAndSendWeeklyExpenseReports().catch(err => {
        this.logger.error(`Error checking weekly expense reports: ${err.message}`);
      });
    }, 60000);
  }

  async generateBriefingMessage(userId: string): Promise<string> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        reminders: {
          where: {
            status: 'pending',
            scheduledAt: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
        },
        tasks: {
          where: {
            status: { in: ['todo', 'doing'] },
          },
        },
      },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const reminderList = user.reminders
      .map(
        r =>
          `- ${r.title} (${new Date(r.scheduledAt).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta',
          })})`,
      )
      .join('\n') || '- Tidak ada pengingat hari ini.';

    const taskList = user.tasks
      .map(t => `- [${t.priority}] ${t.title}`)
      .join('\n') || '- Tidak ada tugas mendesak.';

    // Generate personalized greeting using AI
    const prompt = `Buatlah sapaan briefing pagi hari (Daily Briefing) yang ramah, hangat, dan informatif sebagai asisten virtual MyVA.
Kepribadian asisten: ${user.persona || 'friendly'}
Nama pengguna: ${user.name || 'User'}

Pengingat hari ini:
${reminderList}

Tugas aktif:
${taskList}

Format dengan bahasa Indonesia yang alami, berikan motivasi singkat untuk memulai hari, dan gunakan format markdown WhatsApp (seperti bold menggunakan bintang *text*).`;

    const briefingText = await this.aiService.chat(
      [{ role: 'user', content: prompt }],
      user.persona,
      user.assistantName || 'MyVA',
      'daily_briefing'
    );

    if (briefingText.includes('Mohon Maaf') || briefingText.includes('sedang sangat sibuk')) {
      // Fallback briefing when Gemini API fails/is rate limited
      return `Selamat pagi *${user.name || 'User'}*! 🌅

Mohon maaf, saat ini asisten AI kami sedang dalam batasan kuota untuk menyusun kata-kata pembuka personal. Namun, agenda dan tugas Anda hari ini tetap aman! Berikut rinciannya:

📅 *PENGINGAT HARI INI:*
${reminderList}

📋 *TUGAS AKTIF:*
${taskList}

Semoga hari Anda produktif dan menyenangkan! ✨`;
    }

    return briefingText;
  }

  async sendDailyBriefing(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.waNumber) return;

    this.logger.log(`Generating daily briefing for user ${user.name} (${user.waNumber})`);
    try {
      const message = await this.generateBriefingMessage(userId);
      await this.whatsappApiService.sendMessage(user.waNumber, message);

      // Log outgoing message to conversation
      let conversation = await this.prisma.conversation.findUnique({
        where: {
          userId_waRoomId: {
            userId,
            waRoomId: user.waNumber,
          },
        },
      });

      if (!conversation) {
        conversation = await this.prisma.conversation.create({
          data: {
            userId,
            waRoomId: user.waNumber,
          },
        });
      }

      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'assistant',
          text: message,
        },
      });

      this.logger.log(`Daily briefing successfully sent to ${user.waNumber}`);
    } catch (err) {
      this.logger.error(`Failed to send daily briefing for user ${userId}: ${err.message}`);
    }
  }

  async checkAndSendBriefings(): Promise<void> {
    const now = new Date();
    // Convert current UTC time to Jakarta (WIB, UTC+7)
    const jakartaTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const currentHours = String(jakartaTime.getUTCHours()).padStart(2, '0');
    const currentMinutes = String(jakartaTime.getUTCMinutes()).padStart(2, '0');
    const currentTimeString = `${currentHours}:${currentMinutes}`;

    this.logger.debug(`Checking daily briefings for time: ${currentTimeString}`);

    const usersToBrief = await this.prisma.user.findMany({
      where: {
        briefingEnabled: true,
        briefingTime: currentTimeString,
        waNumber: { not: null },
      },
    });

    for (const user of usersToBrief) {
      await this.sendDailyBriefing(user.id);
      // Delay 2 seconds between users to prevent hitting the Gemini API RPM limit
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  async generateFollowUpMessage(userId: string, taskTitle: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const prompt = `Buatlah pesan pengingat (follow-up) proaktif singkat, ramah, dan memotivasi untuk pengguna WhatsApp dari asisten virtual MyVA.
Kepribadian asisten: ${user.persona || 'friendly'}
Nama pengguna: ${user.name || 'User'}
Nama tugas penting: "${taskTitle}"

Format pesan menggunakan bahasa Indonesia yang ramah, langsung pada sasaran, dan gunakan bold dengan bintang *text* khas WhatsApp.`;

    const response = await this.aiService.chat([{ role: 'user', content: prompt }], user.persona);
    if (response.includes('Mohon Maaf') || response.includes('sedang sangat sibuk')) {
      // Fallback follow-up message when Gemini API fails/is rate limited
      return `Halo *${user.name || 'User'}*, sekadar mengingatkan untuk tugas penting Anda: *"${taskTitle}"*. Semangat menyelesaikannya! 💪`;
    }
    return response;
  }

  async checkAndSendFollowUps(): Promise<void> {
    const now = new Date();
    const currentMinutes = String(now.getMinutes()).padStart(2, '0');

    // Run follow-ups every hour on the hour (or when currentMinutes is '00')
    if (currentMinutes !== '00') return;

    this.logger.log('Checking for active high priority tasks to send Smart Follow Up');
    const users = await this.prisma.user.findMany({
      where: {
        followupEnabled: true,
        waNumber: { not: null },
      },
      include: {
        tasks: {
          where: {
            priority: 'high',
            status: { in: ['todo', 'doing'] },
          },
          take: 1,
        },
      },
    });

    for (const user of users) {
      if (user.tasks.length > 0) {
        const task = user.tasks[0];
        try {
          const message = await this.generateFollowUpMessage(user.id, task.title);
          await this.whatsappApiService.sendMessage(user.waNumber, message);

          // Log outgoing message to conversation
          let conversation = await this.prisma.conversation.findUnique({
            where: {
              userId_waRoomId: {
                userId: user.id,
                waRoomId: user.waNumber,
              },
            },
          });
          if (!conversation) {
            conversation = await this.prisma.conversation.create({
              data: {
                userId: user.id,
                waRoomId: user.waNumber,
              },
            });
          }

          await this.prisma.message.create({
            data: {
              conversationId: conversation.id,
              senderType: 'assistant',
              text: message,
            },
          });

          this.logger.log(`Smart Follow Up sent to ${user.waNumber} for task "${task.title}"`);
        } catch (err) {
          this.logger.error(`Failed to send follow up: ${err.message}`);
        }
        // Delay 2 seconds between users to prevent hitting the Gemini API RPM limit
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  async checkAndSendDeadlineAlerts(): Promise<void> {
    const now = new Date();
    const currentMinutes = String(now.getMinutes()).padStart(2, '0');

    // Run deadline checks every 15 minutes (at :00, :15, :30, :45)
    if (!['00', '15', '30', '45'].includes(currentMinutes)) return;

    this.logger.log('Checking for tasks with approaching deadlines...');

    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: ['todo', 'doing'] },
        deadline: {
          gte: now,
          lte: oneHourFromNow,
        },
      },
      include: {
        user: true,
      },
    });

    for (const task of tasks) {
      if (!task.user?.waNumber) continue;

      const deadlineDate = new Date(task.deadline!);
      const diffMs = deadlineDate.getTime() - now.getTime();
      const diffMinutes = Math.round(diffMs / 60000);

      let timeRemaining: string;
      if (diffMinutes >= 60) {
        timeRemaining = '~1 jam lagi';
      } else if (diffMinutes >= 30) {
        timeRemaining = `${diffMinutes} menit lagi`;
      } else {
        timeRemaining = `${diffMinutes} menit lagi`;
      }

      const priorityEmoji = task.priority === 'high' ? '🔴' : task.priority === 'low' ? '🟢' : '🟡';
      const deadlineTimeStr = deadlineDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
      const deadlineDateStr = deadlineDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });

      const message = `⏳ *Peringatan Deadline!*\n\n${priorityEmoji} *${task.title}*\n📅 Deadline: ${deadlineDateStr} pukul ${deadlineTimeStr} WIB\n⏰ Sisa waktu: *${timeRemaining}*\n\n_Segera selesaikan tugas ini sebelum melewati batas waktu!_ 💪`;

      try {
        await this.whatsappApiService.sendMessage(task.user.waNumber, message);

        // Log outgoing message to conversation
        let conversation = await this.prisma.conversation.findUnique({
          where: {
            userId_waRoomId: {
              userId: task.userId,
              waRoomId: task.user.waNumber,
            },
          },
        });
        if (!conversation) {
          conversation = await this.prisma.conversation.create({
            data: {
              userId: task.userId,
              waRoomId: task.user.waNumber,
            },
          });
        }

        await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: 'assistant',
            text: message,
          },
        });

        this.logger.log(`Deadline alert sent to ${task.user.waNumber} for task "${task.title}" (${timeRemaining})`);
      } catch (err) {
        this.logger.error(`Failed to send deadline alert for task "${task.title}": ${err.message}`);
      }

      // Delay 1 second between sends
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async checkAndSendWeeklyExpenseReports(): Promise<void> {
    const now = new Date();
    // Convert current UTC time to Jakarta (WIB, UTC+7)
    const jakartaTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const day = jakartaTime.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentHours = String(jakartaTime.getUTCHours()).padStart(2, '0');
    const currentMinutes = String(jakartaTime.getUTCMinutes()).padStart(2, '0');
    const currentTimeString = `${currentHours}:${currentMinutes}`;

    // Trigger on Monday mornings at exactly 08:00 WIB
    if (day !== 1 || currentTimeString !== '08:00') {
      return;
    }

    this.logger.log('Triggering automated Weekly Expense Reports for all active users...');
    
    // Retrieve all active users who have waNumber or email
    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
        OR: [
          { waNumber: { not: null } },
          { email: { not: null } }
        ]
      }
    });

    for (const user of users) {
      try {
        await this.sendWeeklyExpenseReport(user.id);
      } catch (err) {
        this.logger.error(`Failed to send weekly expense report for user ${user.id}: ${err.message}`);
      }
      // Delay 2 seconds between users to avoid hitting AI/WhatsApp API rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  async sendWeeklyExpenseReport(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.error(`User ${userId} not found`);
      return;
    }

    const now = new Date();
    const jakartaTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const day = jakartaTime.getUTCDay();

    // Monday of last week (WIB)
    const daysToLastMonday = (day === 0 ? 6 : day - 1) + 7;
    const startOfPrevWeekWib = new Date(jakartaTime);
    startOfPrevWeekWib.setUTCDate(startOfPrevWeekWib.getUTCDate() - daysToLastMonday);
    startOfPrevWeekWib.setUTCHours(0, 0, 0, 0);

    // Sunday of last week (WIB)
    const daysToLastSunday = (day === 0 ? 7 : day);
    const endOfPrevWeekWib = new Date(jakartaTime);
    endOfPrevWeekWib.setUTCDate(endOfPrevWeekWib.getUTCDate() - daysToLastSunday);
    endOfPrevWeekWib.setUTCHours(23, 59, 59, 999);

    const startOfPrevWeekUtc = new Date(startOfPrevWeekWib.getTime() - 7 * 60 * 60 * 1000);
    const endOfPrevWeekUtc = new Date(endOfPrevWeekWib.getTime() - 7 * 60 * 60 * 1000);

    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' };
    const startDateStr = startOfPrevWeekWib.toLocaleDateString('id-ID', options);
    const endDateStr = endOfPrevWeekWib.toLocaleDateString('id-ID', options);

    // Get expenses from previous week
    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        createdAt: {
          gte: startOfPrevWeekUtc,
          lte: endOfPrevWeekUtc,
        },
      },
    });

    const totalSpending = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    // Group by category
    const categoryMap: Record<string, number> = {};
    for (const exp of expenses) {
      const cat = exp.category || 'Lainnya';
      categoryMap[cat] = (categoryMap[cat] || 0) + exp.amount;
    }

    const categoryStats = Object.entries(categoryMap)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    const largestCategory = categoryStats.length > 0 ? categoryStats[0].category : null;
    const largestCategoryAmount = categoryStats.length > 0 ? categoryStats[0].total : 0;

    const budgetStatus = await this.expenseService.checkBudgetStatus(userId);

    // Generate AI commentary/analysis
    let aiCommentary = '';
    if (expenses.length > 0) {
      const categoryListText = categoryStats
        .map(c => `- ${c.category}: Rp ${c.total.toLocaleString('id-ID')}`)
        .join('\n');

      const prompt = `Buatlah analisis ringkas dan saran keuangan pribadi untuk pengguna berdasarkan pengeluaran minggu lalu dan anggaran bulanan mereka sebagai asisten virtual MyVA.
Kepribadian asisten: ${user.persona || 'friendly'}
Nama pengguna: ${user.name || 'User'}

Pengeluaran minggu lalu (${startDateStr} - ${endDateStr}):
- Total: Rp ${totalSpending.toLocaleString('id-ID')}
- Kategori terbesar: ${largestCategory || 'Tidak ada'} (Rp ${largestCategoryAmount.toLocaleString('id-ID')})
- Detail pengeluaran per kategori:
${categoryListText}

Anggaran bulanan:
- Total anggaran bulanan: ${budgetStatus.hasBudget ? `Rp ${budgetStatus.monthlyBudget.toLocaleString('id-ID')}` : 'Belum disetel'}
- Pengeluaran bulan ini (s/d sekarang): Rp ${budgetStatus.monthlyTotal.toLocaleString('id-ID')}
- Status anggaran: ${budgetStatus.hasBudget ? `${budgetStatus.percentage}% terpakai` : '-'}
- Sisa anggaran: ${budgetStatus.hasBudget ? `Rp ${budgetStatus.remaining.toLocaleString('id-ID')}` : '-'}

Berikan komentar/analisis singkat (maksimal 2-3 kalimat atau 60-80 kata), gunakan bahasa Indonesia yang alami sesuai kepribadian asisten Anda, dan gunakan format tebal (*kata*) untuk penekanan khas WhatsApp.`;

      try {
        aiCommentary = await this.aiService.chat(
          [{ role: 'user', content: prompt }],
          user.persona,
          user.assistantName || 'MyVA',
          'weekly_expense_report'
        );
      } catch (err) {
        this.logger.error(`Failed to generate AI commentary for weekly report: ${err.message}`);
        aiCommentary = `Tetap pantau pengeluaranmu agar keuanganmu tetap sehat ya!`;
      }
    } else {
      aiCommentary = `Wah, sepertinya kamu belum mencatat pengeluaran minggu lalu. Yuk, mulai biasakan mencatat pengeluaranmu di MyVA agar kondisi keuanganmu lebih terpantau!`;
    }

    // Build the WhatsApp message
    let message = `📊 *LAPORAN & REKAP KEUANGAN MINGGUAN* 📊\n`;
    message += `Periode: *${startDateStr} - ${endDateStr}*\n\n`;
    message += `Halo *${user.name || 'User'}*! Berikut adalah rekap aktivitas keuanganmu:\n\n`;
    message += `💸 *Total Pengeluaran:* Rp ${totalSpending.toLocaleString('id-ID')}\n`;
    
    if (largestCategory) {
      message += `🗂️ *Kategori Terbesar:* *${largestCategory}* (Rp ${largestCategoryAmount.toLocaleString('id-ID')})\n\n`;
      message += `🔍 *Rincian per Kategori:*\n`;
      categoryStats.forEach(c => {
        message += `- *${c.category}:* Rp ${c.total.toLocaleString('id-ID')}\n`;
      });
      message += `\n`;
    } else {
      message += `Tidak ada pengeluaran yang dicatat minggu lalu. 👍\n\n`;
    }

    message += `📉 *Status Anggaran Bulanan:*\n`;
    if (budgetStatus.hasBudget) {
      const totalBars = 10;
      const filledBars = Math.min(totalBars, Math.round(budgetStatus.percentage / 10));
      const barString = '🟩'.repeat(filledBars) + '⬜'.repeat(totalBars - filledBars);
      
      let statusEmoji = '✅';
      if (budgetStatus.status === 'warning') statusEmoji = '⚠️';
      else if (budgetStatus.status === 'exceeded') statusEmoji = '🚨';

      message += `${barString} (${budgetStatus.percentage}%)\n`;
      message += `- *Anggaran:* Rp ${budgetStatus.monthlyBudget.toLocaleString('id-ID')}\n`;
      message += `- *Terpakai:* Rp ${budgetStatus.monthlyTotal.toLocaleString('id-ID')}\n`;
      message += `- *Sisa:* Rp ${budgetStatus.remaining.toLocaleString('id-ID')}\n`;
      message += `- *Status:* ${statusEmoji} *${budgetStatus.status.toUpperCase()}*\n\n`;
    } else {
      message += `_Anda belum menetapkan anggaran bulanan._\n`;
      message += `_Ketik "set budget [nominal]" di WhatsApp untuk menetapkan anggaran._\n\n`;
    }

    message += `🤖 *Analisis ${user.assistantName || 'MyVA'}:*\n`;
    message += `"${aiCommentary}"\n\n`;
    message += `_Buka dashboard web untuk info selengkapnya!_`;

    let chartUrl = '';
    if (expenses.length > 0) {
      const categories = categoryStats.map(c => c.category);
      const values = categoryStats.map(c => c.total);
      
      const chartConfig = {
        type: 'doughnut',
        data: {
          labels: categories,
          datasets: [{
            data: values,
            backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#E7E9ED', '#8E5EA2', '#3E95CD']
          }]
        },
        options: {
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: '#FFFFFF',
                font: { size: 10 }
              }
            },
            title: {
              display: true,
              text: 'Distribusi Pengeluaran Mingguan',
              color: '#FFFFFF',
              font: { size: 14, weight: 'bold' }
            }
          },
          background: '#1A1A2E'
        }
      };
      chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
    }

    // 1. Send WhatsApp if waNumber is available
    if (user.waNumber) {
      this.logger.log(`Dispatching weekly expense report to WhatsApp: ${user.waNumber}`);
      if (chartUrl) {
        await this.whatsappApiService.sendImage(user.waNumber, { link: chartUrl }, `Distribusi Pengeluaran (${startDateStr} - ${endDateStr})`);
      }
      await this.whatsappApiService.sendMessage(user.waNumber, message);

      // Log outgoing message to conversation
      let conversation = await this.prisma.conversation.findUnique({
        where: {
          userId_waRoomId: {
            userId: user.id,
            waRoomId: user.waNumber,
          },
        },
      });

      if (!conversation) {
        conversation = await this.prisma.conversation.create({
          data: {
            userId: user.id,
            waRoomId: user.waNumber,
          },
        });
      }

      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'assistant',
          text: message,
        },
      });
    }

    // 2. Send Email if email is available
    if (user.email) {
      this.logger.log(`Dispatching weekly expense report to Email: ${user.email}`);
      
      const emailHtmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: 'Inter', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #e2e8f0;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 30px;
      margin: 0 auto;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(10px);
    }
    h1 {
      color: #38bdf8;
      font-size: 24px;
      margin-top: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 15px;
    }
    .period {
      color: #94a3b8;
      font-size: 14px;
      margin-bottom: 25px;
    }
    .metric-box {
      background: rgba(15, 23, 42, 0.6);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 25px;
      border-left: 4px solid #38bdf8;
    }
    .metric-label {
      font-size: 14px;
      color: #94a3b8;
    }
    .metric-value {
      font-size: 28px;
      font-weight: bold;
      color: #f1f5f9;
      margin: 5px 0;
    }
    .chart-container {
      text-align: center;
      margin: 30px 0;
    }
    .chart-img {
      max-width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 25px;
    }
    .table th, .table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .table th {
      color: #94a3b8;
      font-weight: 600;
    }
    .progress-bar-container {
      background: #334155;
      border-radius: 8px;
      height: 12px;
      width: 100%;
      margin: 8px 0;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      border-radius: 8px;
    }
    .progress-bar.safe { background: #10b981; }
    .progress-bar.warning { background: #f59e0b; }
    .progress-bar.exceeded { background: #ef4444; }
    .ai-box {
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 12px;
      padding: 20px;
      margin-top: 30px;
      font-style: italic;
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      font-size: 12px;
      color: #64748b;
    }
    .footer a {
      color: #38bdf8;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Laporan Keuangan Mingguan</h1>
    <div class="period">Periode: <strong>${startDateStr} - ${endDateStr}</strong></div>
    
    <p>Halo <strong>${user.name || 'User'}</strong>,</p>
    <p>Berikut adalah rekap ringkas pengeluaran mingguan Anda yang disusun otomatis oleh asisten keuangan pribadi Anda, <strong>${user.assistantName || 'MyVA'}</strong>.</p>
    
    <div class="metric-box">
      <div class="metric-label">Total Pengeluaran Minggu Lalu</div>
      <div class="metric-value">Rp ${totalSpending.toLocaleString('id-ID')}</div>
      ${largestCategory ? `<div class="metric-label">Kategori Terbesar: <strong>${largestCategory}</strong> (Rp ${largestCategoryAmount.toLocaleString('id-ID')})</div>` : ''}
    </div>

    ${expenses.length > 0 ? `
    <h3>Detail Pengeluaran per Kategori</h3>
    <table class="table">
      <thead>
        <tr>
          <th>Kategori</th>
          <th style="text-align: right;">Jumlah</th>
        </tr>
      </thead>
      <tbody>
        ${categoryStats.map(c => `
          <tr>
            <td>${c.category}</td>
            <td style="text-align: right; font-weight: 600;">Rp ${c.total.toLocaleString('id-ID')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    ${chartUrl ? `
    <div class="chart-container">
      <img class="chart-img" src="${chartUrl}" alt="Visualisasi Pengeluaran" />
    </div>
    ` : ''}
    ` : '<p>Tidak ada pengeluaran yang dicatat pada minggu lalu.</p>'}

    <h3>📉 Status Anggaran Bulanan</h3>
    <div class="metric-box" style="border-left-color: ${budgetStatus.status === 'exceeded' ? '#ef4444' : budgetStatus.status === 'warning' ? '#f59e0b' : '#10b981'};">
      ${budgetStatus.hasBudget ? `
        <div><strong>${budgetStatus.percentage}%</strong> terpakai dari total anggaran Rp ${budgetStatus.monthlyBudget.toLocaleString('id-ID')}</div>
        <div class="progress-bar-container">
          <div class="progress-bar ${budgetStatus.status}" style="width: ${Math.min(100, budgetStatus.percentage)}%;"></div>
        </div>
        <div style="font-size: 13px; margin-top: 5px; color: #94a3b8;">
          Terpakai: Rp ${budgetStatus.monthlyTotal.toLocaleString('id-ID')} | Sisa: Rp ${budgetStatus.remaining.toLocaleString('id-ID')}
        </div>
      ` : `
        <p style="margin: 0; font-size: 14px;">Anda belum menetapkan anggaran bulanan. Menetapkan anggaran bulanan membantu Anda membatasi pengeluaran dan menabung lebih banyak!</p>
        <p style="margin: 5px 0 0 0; font-size: 13px; color: #94a3b8;">Ketik "set budget [nominal]" di WhatsApp Anda untuk menyetel anggaran sekarang.</p>
      `}
    </div>

    <div class="ai-box">
      <strong>🤖 Catatan dari ${user.assistantName || 'MyVA'}:</strong><br/>
      "${aiCommentary.replace(/\*(.*?)\*/g, '<strong>$1</strong>')}"
    </div>

    <div class="footer">
      Email ini dikirim secara otomatis oleh <a href="https://myva.ai">MyVA Second Brain Assistant</a>.<br/>
      Kelola preferensi notifikasi Anda di <a href="https://myva.ai/settings">Dashboard Pengaturan</a>.
    </div>
  </div>
</body>
</html>
`;

      const emailText = `Laporan Keuangan Mingguan MyVA\n` + 
        `Periode: ${startDateStr} - ${endDateStr}\n\n` + 
        `Halo ${user.name || 'User'},\n\n` + 
        `Berikut rekap pengeluaran Anda minggu lalu:\n` + 
        `- Total Pengeluaran: Rp ${totalSpending.toLocaleString('id-ID')}\n` + 
        (largestCategory ? `- Kategori Terbesar: ${largestCategory} (Rp ${largestCategoryAmount.toLocaleString('id-ID')})\n` : '') + 
        `\nStatus Anggaran Bulanan:\n` + 
        (budgetStatus.hasBudget ? `- Terpakai: Rp ${budgetStatus.monthlyTotal.toLocaleString('id-ID')} dari Rp ${budgetStatus.monthlyBudget.toLocaleString('id-ID')} (${budgetStatus.percentage}%)\n` : 'Belum disetel\n') + 
        `\nAnalisis ${user.assistantName || 'MyVA'}:\n"${aiCommentary}"\n\n` + 
        `Buka dashboard MyVA untuk informasi lebih lengkap.`;

      await this.emailQueue.add('send_weekly_expense_report', {
        to: user.email,
        subject: `📊 Laporan Keuangan Mingguan: ${startDateStr} - ${endDateStr}`,
        text: emailText,
        html: emailHtmlBody,
        template: 'weekly_expense_report',
      });
    }
  }
}
