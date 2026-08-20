import { Link } from 'react-aria-components';

import * as styles from './styles.css';

import type { ObjectDescriptor } from '@r2-drive/core';

type Props = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

const byteFormat = new Intl.NumberFormat('en-US');

export const ViewerTooLarge = ({ object, getContentUrl }: Props) => (
  <div className={styles.root}>
    <p>
      大きすぎるため表示できません(<span className={styles.size}>{byteFormat.format(object.size)} B</span>)
    </p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);
