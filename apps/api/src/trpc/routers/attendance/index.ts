import { router } from '../../trpc';

import { attendanceCorrectionProcedures } from './corrections';
import { attendanceRecordProcedures } from './records';

export const attendanceRouter = router({
  ...attendanceRecordProcedures,
  ...attendanceCorrectionProcedures,
});
