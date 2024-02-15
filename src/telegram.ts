import { Menu } from "@grammyjs/menu";
import { Bot, Context, InlineKeyboard, Keyboard, session } from "grammy";
import { StudentModel } from "./models/student";
import { ScheduleParser } from "./parsers";
import { BotContext, GET_TODAY, GET_TOMORROW, GET_WEEK, OLD_TODAY, SELECT_SUBGROUP, SETTINGS, Schedule, SessionData } from "./utils";
import nodeHtmlToImage from 'node-html-to-image'
import fs from 'fs';

export class Telegram {
  private bot: Bot<BotContext>;
  private settings: Menu<BotContext>;
  private keyboard: Keyboard;

  constructor(private readonly scheduleParser: ScheduleParser) {
    const bot = new Bot<BotContext>(process.env.TELEGRAM_TOKEN || "");

    bot.use(session({
      initial(): SessionData {
        return { isWaitingSubgroup: false };
      }
    }));

    this.bot = bot;
    this.settings = this.buildSettings();
    this.keyboard = this.buildKeyboard();
    this.bindEvents();

    this.bot.start();
  }

  private buildKeyboard() {
    const keyboard = new Keyboard();
    keyboard.text(GET_WEEK).row();
    keyboard.text(GET_TODAY);
    keyboard.text(GET_TOMORROW).row();
    keyboard.text(SETTINGS).row();
    keyboard.resized();
    return keyboard;
  }

  private buildSettings() {
    const settings = new Menu<BotContext>("settings").submenu("Группы", "groups");
    settings.text("Подгруппа", async (ctx) => {
      const student = await StudentModel.findOne({ telegramId: ctx.from.id });
      if (!student || !student.groupId) return await ctx.reply("Сначала выберите группу!");

      const subgroupsMenu = new InlineKeyboard();

      const subgroups = this.scheduleParser.groupsParser.subgroups[student.groupId];
      if (!subgroups) {
        ctx.session.isWaitingSubgroup = true;
        return await ctx.reply("Введите подгруппу (скопируйте с сайта):");
      }

      subgroups.forEach((subgroup) => {
        subgroupsMenu.text(subgroup, SELECT_SUBGROUP + `:${subgroup}`).row();
      });

      return await ctx.reply("Выберите подгруппу:", { reply_markup: subgroupsMenu });
    }).row();

    settings.text("Проверить данные", async (ctx) => {
      if (ctx.session.isWaitingSubgroup) return;

      const id = ctx.from.id;
      const student = await StudentModel.findOne({ telegramId: id });

      if (student && student.groupId && student.subgroup) return await ctx.reply("Выберите пункт в меню", { reply_markup: this.keyboard });

      return await ctx.reply("Ещё не все данные указаны!");
    }).row();

    // Groups menu
    const groupsMenu = new Menu<BotContext>("groups");

    const groups = this.scheduleParser.groupsParser.groups;
    groups.forEach((group) => {
      groupsMenu.text(group.label, async (ctx) => {
        const id = ctx.from.id;

        const student = await StudentModel.findOne({ telegramId: id });
        if (!student) return await ctx.reply("Для начала воспользуйтесь командой /start");

        await student.updateOne({ telegramId: student.telegramId, groupId: group.value, subgroup: student.subgroup, id: student.id }).exec();

        ctx.menu.back();
        await ctx.reply(`Вы выбрали ${group.label}`);
      }).row();
    });

    groupsMenu.back("Назад");

    this.bot.use(settings);
    settings.register(groupsMenu);
    return settings;
  }

  private bindEvents() {
    this.bot.catch((err) => {
      console.log(err);
      err.ctx.reply("Произошла ошибка! Попробуйте позже или сообщите разработчику @kostrominoff!");
    });

    this.bot.command("start", async (ctx) => {
      const id = ctx.message?.from.id;
      if (!id) return await ctx.reply("Произошла ошибка! Попробуйте ещё раз ввести команду /start");

      const student = await StudentModel.findOne({ telegramId: id });
      if (student && student.groupId && student.subgroup) return await ctx.reply("Вам доступно меню!", { reply_markup: this.keyboard });

      const newStudent = new StudentModel({ telegramId: id });
      await newStudent.save();

      await ctx.reply("Укажите группу и подгруппу:", { reply_markup: this.settings });
    });

    this.bot.on("callback_query:data", async (ctx) => {
      if (!ctx.callbackQuery.data.startsWith(SELECT_SUBGROUP)) return;

      const student = await StudentModel.findOne({ telegramId: ctx.from.id });
      if (!student) {
        ctx.session.isWaitingSubgroup = false;
        await ctx.answerCallbackQuery("Ошибка!");
        return await ctx.reply("Для начала воспользуйтесь командой /start");
      }

      const subgroup = ctx.callbackQuery.data.split(":").at(-1)?.trim();
      if (!subgroup) {
        await ctx.answerCallbackQuery("Ошибка!");
        return await ctx.reply("Ошибка обработки подгруппы!");
      }


      await student.updateOne({ telegramId: student.telegramId, groupId: student.groupId, id: student.id, subgroup }).exec();
      ctx.session.isWaitingSubgroup = false;
      await ctx.reply(`Подгруппа ${subgroup} сохранена!`);
      await ctx.answerCallbackQuery("Сохранено!");
    });

    this.bot.on("message:text", async (ctx) => {
      const student = await StudentModel.findOne({ telegramId: ctx.from.id });

      // Сохранить подгруппу
      if (ctx.session.isWaitingSubgroup) {
        const subgroup = ctx.message.text;

        if (!student) {
          ctx.session.isWaitingSubgroup = false;
          return await ctx.reply("Для начала воспользуйтесь командой /start");
        }

        await student.updateOne({ telegramId: student.telegramId, groupId: student.groupId, id: student.id, subgroup }).exec();
        ctx.session.isWaitingSubgroup = false;
        await ctx.reply(`Подгруппа ${subgroup} сохранена!`);
      }

      // Проверка на валидность студента
      if (!student || !student.groupId || !student.subgroup) return await ctx.reply("Начните с команды /start");

      // Открыть настройки
      if (ctx.message.text === SETTINGS) {
        return await ctx.reply("В случае ошибки обратитесь к @kostrominoff\nНастройки:", { reply_markup: this.settings });
      }

      // Получить расписание на неделю
      if (ctx.message.text === GET_WEEK) {
        const schedules = this.scheduleParser.findByGroup(student.groupId, student.subgroup);
        // const htmlContent = fs.readFileSync("./index.html", 'utf8');
        // Тут сам правь
        /*
        await nodeHtmlToImage({
          output:'./image' + student.groupId + '.png' ,
          html: htmlContent,
          content: {sh: Object.values(schedules)},
        })
        await ctx.replyWithDocument(new InputFile("./image" + student.groupId + ".png"))
        */

        // Это отправка сообщений
        await this.sendScheduleMessages(ctx, schedules);

        return;
      }

      if (ctx.message.text === OLD_TODAY) {
        await ctx.reply("Теперь используйте новую кнопку! В случае ошибки обратитесь к @kostrominoff", { reply_markup: this.keyboard });
        return;
      }

      // Получить расписание на сегодня
      if (ctx.message.text === GET_TODAY) {

        const schedules = this.scheduleParser.findByDate(student.groupId, student.subgroup);
        await this.sendScheduleMessages(ctx, schedules);

        return;
      }

      // Получить расписание на завтра
      if (ctx.message.text === GET_TOMORROW) {
        const schedules = this.scheduleParser.findByDate(student.groupId, student.subgroup, true);
        await this.sendScheduleMessages(ctx, schedules);

        return;
      }
    });
  }

  private async sendScheduleMessages(ctx: Context, schedules: Record<string, Schedule[]> | null) {
    if (!schedules) return await ctx.reply("Расписание не найдено!", { reply_markup: this.keyboard });

    const messages = this.buildScheduleMessage(schedules);
    if (!messages) return await ctx.reply("Расписание не найдено!", { reply_markup: this.keyboard });

    for await (const message of messages) {
      if (!message) {
        await ctx.reply("Расписание не найдено!", { reply_markup: this.keyboard });
        continue;
      }

      await ctx.reply(message, { parse_mode: "HTML", reply_markup: this.keyboard });
    }
  }

  private buildScheduleMessage(schedules: Record<string, Schedule[]>): string[] {
    const messages = Object.entries(schedules).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime()).map(([date, schedules]) => {
      const dayWeek = Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(new Date(date.split(".").reverse().join("-")));
      if (!schedules) return "";

      const todaySchedules = schedules.sort((a, b) => a.daytime_start.localeCompare(b.daytime_start)).map((schedule, index) => {
        return `<b>${index + 1})</b> ${schedule.discipline_name} (${schedule.classtype_name})\nПреподаватель: ${schedule.teacher_fio}\nВремя: ${schedule.daytime_name}\nКабинет: ${schedule.cabinet_fullnumber_wotype}`;
      }).join("\n\n");

      const message = `📆 <b>${dayWeek.toUpperCase()} (${date})</b>\n${todaySchedules}`;
      return message;
    });

    const message = messages.join("\n\n\n");

    if (message.length > 4096) {
      const midpoint = Math.ceil(messages.length / 2);
      const splittedMessages = [messages.slice(0, midpoint).join("\n\n"), messages.slice(midpoint).join("\n\n")];
      return splittedMessages;
    }
    return [message];
  }

}
