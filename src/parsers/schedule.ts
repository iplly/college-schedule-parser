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

    setInterval(() => this.getSchedules(), HOUR);
  }

  private async getSchedules() {
    const thisWeek = this.weeksParser.getCurrentWeek();

    if (!thisWeek || !this.semestersParser.semester || !this.groupsParser.groups.length) {
      console.log("[ScheduleParser] Повторное получение расписаний через 5 секунд!");
      setTimeout(() => this.getSchedules(), FIVE_SECONDS);
      return;
    }

    for await (const group of this.groupsParser.groups) {
      const { data } = await axios.post<Schedule[]>(SCHEDULE_URL, {
        studyyear_id: this.siteParser.extractStudyYearId(),
        stream_id: group.value,
        term: this.semestersParser.semester.value,
        start_date: thisWeek.start_date,
        end_date: thisWeek.end_date
      });

      this.schedules = this.schedules.concat(data);
    }
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
