import axios from "axios";
import { GroupsParser } from "./groups";
import { SemesterParser } from "./semesters";
import { SiteParser } from "./site";
import { WeeksParser } from "./weeks";
import { FIVE_SECONDS, HOUR, SCHEDULE_URL, Schedule } from "../utils";

export class ScheduleParser {
  private schedules: Schedule[] = [];

  constructor(
    readonly groupsParser: GroupsParser,
    readonly semestersParser: SemesterParser,
    readonly weeksParser: WeeksParser,
    readonly siteParser: SiteParser,
  ) {
    this.getSchedules();
    const semester = this.semestersParser.semester?.value;
    const currentWeek = this.weeksParser.getCurrentWeek()?.value;
    if (semester && currentWeek) this.groupsParser.getSubgroups(semester, currentWeek);

    setInterval(() => {
      const semester = this.semestersParser.semester?.value;
      const currentWeek = this.weeksParser.getCurrentWeek()?.value;
      if (semester && currentWeek) this.groupsParser.getSubgroups(semester, currentWeek);

      this.getSchedules();
    }, HOUR);
  }

  private async getSchedules() {
    const thisWeek = this.weeksParser.getCurrentWeek();

    if (!thisWeek || !this.semestersParser.semester || !this.groupsParser.groups.length) {
      console.log("[ScheduleParser] Повторное получение расписаний через 5 секунд!");
      setTimeout(() => this.getSchedules(), FIVE_SECONDS);
      return;
    }

    const schedules: Schedule[] = [];

    for await (const group of this.groupsParser.groups) {
      const { data } = await axios.post<Schedule[]>(SCHEDULE_URL, {
        studyyear_id: this.siteParser.extractStudyYearId(),
        stream_id: group.value,
        term: this.semestersParser.semester.value,
        start_date: thisWeek.start_date,
        end_date: thisWeek.end_date
      });

      schedules.push(...data);
    }

    this.schedules = schedules;
  }

  private formatDateToKey(date: Date): string {
    const day = `${date.getDate()}`.padStart(2, "0");
    const month = `${(1 + date.getMonth())}`.padStart(2, "0");
    const year = `${date.getFullYear()}`;

    const key = `${day}.${month}.${year}`;

    return key;
  }

  findByDate(groupId: string, subgroup: string, isTommorow = false): Record<string, Schedule[]> | null {
    const today = new Date(Date.now());

    if (isTommorow) {
      today.setDate(today.getDate() + 1);
    }

    const schedules = this.findByGroup(groupId, subgroup);

    const todayKey = this.formatDateToKey(today);
    const schedulesToday: Record<string, Schedule[]> = {};
    if (!schedules[todayKey]) return null;

    schedulesToday[todayKey] = schedules[todayKey];

    return schedulesToday;
  }

  findByGroup(groupId: string, subgroup: string): Record<string, Schedule[]> {
    const schedules = this.schedules.filter((schedule) => groupId === schedule.stream_id.toString() && (schedule.subgroup_name === subgroup || !schedule.classtype_name.includes("подгрупп")));

    return schedules.reduce((acc, schedule) => {
      const key = schedule.date_start_text;

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(schedule);

      return acc;
    }, {} as Record<string, Schedule[]>);
  }
}
