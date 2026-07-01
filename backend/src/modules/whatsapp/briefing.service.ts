import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppApiService } from '../../integrations/whatsapp-api.service';
import { AIService } from '../ai/ai.service';

@Injectable()
export class BriefingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappApiService: WhatsAppApiService,
    private readonly aiService: AIService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Daily Briefing, Follow Up & Deadline Alert Scheduler initialized. Checking intervals every 60 seconds.');
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
}
