import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The AccountPicker trigger whose visible label is `label`; its accessible name is the label followed by the value. */
export const accountPicker = (label: string) => screen.getByRole('button', { name: new RegExp(`^${escape(label)}(\\s|$)`) })

/** Opens the picker labelled `label` and chooses the option named `option` (an option's name is its label, then venue, source and details). */
export async function chooseInPicker(label: string, option: string, user: Pick<typeof userEvent, 'click'> = userEvent) {
  await user.click(accountPicker(label))
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${escape(option)}(,|$)`) }))
}
